// Lambda entry point.
// Constructs the dependency graph (Bedrock client, pg pool, loaders) on cold
// start and exposes a single `handler(event)` that AWS Lambda invokes.
//
// Test harnesses bypass this file and import `handleTurn` from handler.ts
// directly with their own mocks.

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient } from '@aws-sdk/client-sqs';
import { resolve as resolvePath } from 'node:path';

import { handleTurn, handleTurnStream, TurnRequest, TurnResponse, HandlerDeps } from './handler';
import { CollectingSseEmitter, serializeEvent } from './sse_events';
import { AwsBedrockInvoker } from './bedrock_client';
import { MalformedJsonBedrockInvoker, parseChaosMode } from './bedrock_chaos';
import {
  PgPatientContextLoader,
  PgTurnContextLoader,
  PgSessionCreator,
  PgSessionPersister,
  PgModelCallRecorder,
  PgPivotedPatientLookup,
} from './db';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { LambdaPatientFromVoiceCreator } from './patient_from_voice';
import { SqsAlertEnqueuer } from './alert_queue';
import { HaikuSummarizer } from './summarizer';
import { PgRateLimiter } from './rate_limiter';
import { S3Client } from '@aws-sdk/client-s3';
import { SonnetProtocolExtractor } from './protocol_extractor';
import { PgProtocolPersister } from './protocol_persister';
import { PgUserResolver } from './user_resolver';
import { S3ObservationWriter } from './observation_writer';
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

  // Caregiver-onboarding protocol extractor (T-V2-302). Sonnet handles the
  // structured-extraction pass at session close; persister upserts into
  // parameter_configs + patient_topics in one transaction.
  const sonnetModelId = requiredEnv('BEDROCK_SONNET_MODEL_ID');
  const protocolExtractor = new SonnetProtocolExtractor(
    bedrock,
    sonnetModelId,
    inferenceRegion,
    resolvePath(LAMBDA_ROOT, 'prompts', 'extract_caregiver_protocol.md'),
  );
  const protocolPersister = new PgProtocolPersister(pool);

  // F23 — voice patient onboarding plumbing. Wired only when the env
  // var is set (terraform threads CREATE_PATIENT_FROM_VOICE_FN_NAME
  // through). When missing, caregiver_onboarding placeholder turns
  // get processed but the pivot turn errors out — acceptable for
  // local dev / tests where the dependency isn't always available.
  const lambdaClient = new LambdaClient({ region: awsRegion });
  const createPatientFromVoiceFn = process.env.CREATE_PATIENT_FROM_VOICE_FN_NAME;
  const patientFromVoiceCreator = createPatientFromVoiceFn
    ? new LambdaPatientFromVoiceCreator(lambdaClient, createPatientFromVoiceFn)
    : undefined;

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
    protocolExtractor,
    protocolPersister,
    userResolver: new PgUserResolver(pool),
    observationWriter: process.env.FHIR_OBSERVATIONS_BUCKET
      ? new S3ObservationWriter(
          new S3Client({ region: awsRegion }),
          process.env.FHIR_OBSERVATIONS_BUCKET,
          process.env.FHIR_OBSERVATIONS_KMS_KEY_ID,
        )
      : undefined,
    patientFromVoiceCreator,
    pivotedPatientLookup: new PgPivotedPatientLookup(pool),
    config: {
      haikuModelId,
      sonnetModelId,
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
      // F23 — profile-extraction phase prompt. Selected when the
      // session's fsm_state is in EXTRACTING_PROFILE or
      // AWAITING_PROFILE_CONFIRMATION (pre-pivot).
      caregiverOnboardingProfilePromptPath: resolvePath(
        LAMBDA_ROOT,
        'prompts',
        'system_v2_caregiver_onboarding_profile.md',
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
  // The route's resource template (e.g. "/conversation/turn" or
  // "/conversation/turn-stream"). Stable across stages.
  resource?: string;
  path?: string;
  // EDGE-V2-09 chaos hook reads `x-test-chaos`. Header name casing varies
  // by API GW integration version, so the helper checks both forms.
  headers?: Record<string, string>;
}

/**
 * EDGE-V2-09 — case-insensitive header lookup. API GW REST integrations
 * preserve header case as sent by the client; HTTP API normalizes to
 * lowercase. We accept either.
 */
function getHeader(event: ApiGatewayProxyEvent, name: string): string | undefined {
  const headers = event.headers ?? {};
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
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

function isStreamingPath(event: ApiGatewayProxyEvent): boolean {
  // Match either the resource template or the deployed path. Both should
  // end with `/turn-stream`. Defensive: treat missing fields as non-streaming.
  const path = event.resource ?? event.path ?? '';
  return path.endsWith('/turn-stream');
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

  // EDGE-V2-09 fault-injection. Production never sets this header; only
  // the cognito-harness-maestro.sh edge-v2-09 wrapper does. Per-invocation
  // wrapping (no shared state across requests) so chaos can't leak into
  // a concurrent normal request.
  const chaosMode = parseChaosMode(getHeader(event, 'x-test-chaos'));
  if (chaosMode === 'malformed_json') {
    console.warn('chaos_mode_active', { mode: chaosMode });
    deps = { ...deps, bedrock: new MalformedJsonBedrockInvoker(deps.bedrock) };
  }

  if (isStreamingPath(event)) {
    return handleStreamingProxyInvocation(payload, deps);
  }

  try {
    const result = await handleTurn(payload, deps);
    // `handleTurn` already returns `{ statusCode, body: <stringified
    // TurnResponseBody> }` — the API Gateway proxy shape minus the
    // headers field. Pass `result.body` through directly: re-wrapping
    // it with jsonResponse(200, result) would double-stringify and
    // ship `{"statusCode":200,"body":"..."}` to the client, where the
    // outer envelope's keys don't match TurnResponseBody and Gson
    // silently drops every field.
    return {
      statusCode: result.statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: result.body,
    };
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

// Streaming variant. API Gateway REST integrations buffer the full Lambda
// response, so this collects all SSE events into the body rather than
// streaming them on the wire. The wire format is still SSE-compliant
// (`event: ... \ndata: ... \n\n` per event), so a fetch() consumer can
// parse incrementally from the buffered body. Real per-token streaming
// requires moving the route to a Lambda Function URL with response
// streaming or to API Gateway HTTP API — deferred to v2.1 per the
// pre-pilot status doc.
async function handleStreamingProxyInvocation(
  payload: TurnRequest,
  deps: HandlerDeps,
): Promise<ApiGatewayProxyResponse> {
  const emitter = new CollectingSseEmitter();
  let threw = false;
  try {
    await handleTurnStream(payload, deps, emitter);
  } catch (err) {
    threw = true;
    // handleTurnStream's own catch always emits an `error` event AND
    // calls emitter.end() before re-throwing, so emitter.events already
    // contains the structured failure. We just log here for CloudWatch
    // and proceed to serialize the buffered events.
    console.error('handleTurnStream failed', err);
  }

  const body = emitter.events.map(serializeEvent).join('');

  // SSE convention: stream-level failures (mid-turn) are delivered as
  // events in a 200 response; clients inspect events, not status codes.
  // Pre-stream validation failures (no prelude was ever emitted) get a
  // 4xx so non-SSE-aware tooling sees the failure clearly.
  const onlyErrorEvent =
    threw &&
    emitter.events.length === 1 &&
    emitter.events[0].type === 'error';
  const validationFailed =
    onlyErrorEvent &&
    /required|invalid|forbidden|not.allowed|rate.limit|exceeded/i.test(
      (emitter.events[0] as { data: { message: string } }).data.message,
    );

  return {
    statusCode: validationFailed ? 400 : 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      // Hint to intermediaries (CloudFront, nginx) not to buffer if they
      // do support streaming pass-through. API Gateway REST itself still
      // buffers regardless.
      'X-Accel-Buffering': 'no',
    },
    body,
  };
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
