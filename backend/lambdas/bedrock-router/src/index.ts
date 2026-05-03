// Lambda entry point.
// Constructs the dependency graph (Bedrock client, pg pool, loaders) on cold
// start and exposes a single `handler(event)` that AWS Lambda invokes.
//
// Test harnesses bypass this file and import `handleTurn` from handler.ts
// directly with their own mocks.

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient } from '@aws-sdk/client-sqs';
import { resolve as resolvePath } from 'node:path';

import { handleTurn, TurnRequest, TurnResponse, HandlerDeps } from './handler';
import { AwsBedrockInvoker } from './bedrock_client';
import {
  PgPatientContextLoader,
  PgTurnContextLoader,
  PgSessionCreator,
  PgSessionPersister,
  PgModelCallRecorder,
} from './db';
import { SqsAlertEnqueuer } from './alert_queue';
import { HaikuSummarizer } from './summarizer';
import { PgRateLimiter } from './rate_limiter';
import { getPgPool } from './db_secret';

// Cold-start: build deps once, reuse across warm invocations.
let _deps: HandlerDeps | null = null;

async function buildDeps(): Promise<HandlerDeps> {
  if (_deps !== null) return _deps;

  const inferenceRegion = process.env.INFERENCE_PROFILE_REGION ?? 'ap-southeast-1';
  const awsRegion = process.env.AWS_REGION ?? 'ap-south-1';

  const bedrockClient = new BedrockRuntimeClient({ region: inferenceRegion });
  const bedrock = new AwsBedrockInvoker(bedrockClient);

  // Pg credentials are fetched at runtime from Secrets Manager (see
  // db_secret.ts). The Lambda's env var DB_SECRET_ARN points at the secret;
  // no PG password ever sits in the function's environment configuration.
  const pool = await getPgPool();

  // Alert queue — optional. Only wired when MATIKA_ALERT_QUEUE_URL is set.
  // Without it, emergency triggers are detected but not enqueued (telemetry
  // and session state still record the event, so nothing is silently lost).
  const alertQueueUrl = process.env.MATIKA_ALERT_QUEUE_URL;
  const alertEnqueuer = alertQueueUrl
    ? new SqsAlertEnqueuer(new SQSClient({ region: awsRegion }), alertQueueUrl)
    : undefined;

  // Lambda zip layout: prompts/ + escalation_subprompts/ live at the deploy
  // root (/var/task/), while compiled handler code lives at
  // /var/task/dist/src/index.js. Two `..` segments take us from src/ → dist/
  // → deploy root.
  const LAMBDA_ROOT = resolvePath(__dirname, '..', '..');

  const haikuModelId = requiredEnv('BEDROCK_HAIKU_MODEL_ID');
  const summarizer = new HaikuSummarizer(
    bedrock,
    haikuModelId,
    inferenceRegion,
    resolvePath(LAMBDA_ROOT, 'prompts', 'summarize.md'),
  );

  const softLimit = parseInt(process.env.SOFT_RATE_LIMIT_PER_PATIENT ?? '100', 10);
  const hardLimit = parseInt(process.env.HARD_RATE_LIMIT_PER_PATIENT ?? '500', 10);
  const rateLimiter = new PgRateLimiter(pool, { softLimit, hardLimit });

  const deps: HandlerDeps = {
    bedrock,
    patientLoader: new PgPatientContextLoader(pool),
    turnLoader: new PgTurnContextLoader(pool),
    sessionCreator: new PgSessionCreator(pool),
    sessionPersister: new PgSessionPersister(pool),
    modelCallRecorder: new PgModelCallRecorder(pool),
    alertEnqueuer,
    summarizer,
    rateLimiter,
    config: {
      haikuModelId,
      sonnetModelId: requiredEnv('BEDROCK_SONNET_MODEL_ID'),
      guardrailId: process.env.BEDROCK_GUARDRAIL_ID,
      guardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION,
      inferenceRegion,
      maxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS ?? '1024', 10),
      systemPromptPath: resolvePath(LAMBDA_ROOT, 'prompts', 'system_v2.md'),
      caregiverOnboardingPromptPath: resolvePath(
        LAMBDA_ROOT,
        'prompts',
        'system_v2_caregiver_onboarding.md',
      ),
      escalationSubpromptDir: resolvePath(LAMBDA_ROOT, 'escalation_subprompts'),
      hardRateLimitPerPatient: hardLimit,
    },
  };
  _deps = deps;
  return deps;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable not set: ${name}`);
  }
  return value;
}

// Lambda is invoked through API Gateway proxy integration, which delivers
// the body as a JSON-stringified `body` field on the event (not as the event
// itself). Detect that shape, unwrap it, and emit a proxy-shaped response.
// Direct invocation (tests, manual aws lambda invoke) is still supported
// when the event already looks like a TurnRequest.

interface ApiGatewayProxyEvent {
  body: string | null;
  isBase64Encoded?: boolean;
}

interface ApiGatewayProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function isProxyEvent(event: unknown): event is ApiGatewayProxyEvent {
  return (
    event !== null &&
    typeof event === 'object' &&
    'body' in event &&
    !('sessionId' in event)
  );
}

function jsonResponse(statusCode: number, body: unknown): ApiGatewayProxyResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function handleProxyInvocation(
  event: ApiGatewayProxyEvent,
  deps: HandlerDeps,
): Promise<ApiGatewayProxyResponse> {
  let payload: TurnRequest;
  try {
    payload = JSON.parse(event.body ?? '{}') as TurnRequest;
  } catch (err) {
    return jsonResponse(400, {
      error: 'invalid_json',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await handleTurn(payload, deps);
    return jsonResponse(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isClientError = /required|invalid|forbidden|not.allowed|rate.limit|exceeded/i.test(
      message,
    );
    // Log the full error with stack so CloudWatch surfaces it; the response
    // body only carries the message string.
    if (!isClientError) {
      console.error('handleTurn failed', err);
    }
    return jsonResponse(isClientError ? 400 : 500, {
      error: isClientError ? 'invalid_request' : 'internal_error',
      message,
    });
  }
}

export async function handler(
  event: TurnRequest | ApiGatewayProxyEvent,
): Promise<TurnResponse | ApiGatewayProxyResponse> {
  const deps = await buildDeps();
  if (isProxyEvent(event)) {
    return handleProxyInvocation(event, deps);
  }
  return handleTurn(event, deps);
}
