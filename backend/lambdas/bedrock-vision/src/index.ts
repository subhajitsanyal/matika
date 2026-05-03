// AWS Lambda entry point. Constructs deps on cold start.

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { resolve as resolvePath } from 'node:path';

import { handlePhotoExtract, PhotoExtractRequest, PhotoExtractResponse, VisionHandlerDeps } from './handler';
import { AwsBedrockVisionInvoker } from './bedrock_client';
import { S3PhotoLoader } from './s3_loader';
import { PgVisionModelCallRecorder } from './telemetry';

let _deps: VisionHandlerDeps | null = null;

function buildDeps(): VisionHandlerDeps {
  if (_deps) return _deps;

  const inferenceRegion = process.env.INFERENCE_PROFILE_REGION ?? 'ap-southeast-1';
  const bedrockClient = new BedrockRuntimeClient({ region: inferenceRegion });
  const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // undefined → falls back to PG* env vars
    max: 1,
    // See bedrock-router/src/index.ts — RDS rds.force_ssl on PG15.
    ssl: { rejectUnauthorized: false },
  });

  _deps = {
    bedrock: new AwsBedrockVisionInvoker(bedrockClient),
    photoLoader: new S3PhotoLoader(s3Client, requiredEnv('RAW_INTERACTIONS_BUCKET')),
    modelCallRecorder: new PgVisionModelCallRecorder(pool),
    config: {
      haikuModelId: requiredEnv('BEDROCK_HAIKU_MODEL_ID'),
      sonnetModelId: requiredEnv('BEDROCK_SONNET_MODEL_ID'),
      guardrailId: process.env.BEDROCK_GUARDRAIL_ID,
      guardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION,
      inferenceRegion,
      maxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS ?? '512', 10),
      // src/index.ts → dist/src/index.js; prompts/ at deploy root → ../..
      promptPath: resolvePath(__dirname, '..', '..', 'prompts', 'extract_value.md'),
      haikuConfidenceThreshold: parseFloat(
        process.env.HAIKU_CONFIDENCE_THRESHOLD ?? '0.80',
      ),
    },
  };
  return _deps;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable not set: ${name}`);
  return value;
}

// API Gateway proxy event-shape unwrap (see bedrock-router/src/index.ts for
// the full rationale). Direct invocation is still supported.

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
    !('photoS3Key' in event) &&
    !('s3Key' in event)
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
  deps: VisionHandlerDeps,
): Promise<ApiGatewayProxyResponse> {
  let payload: PhotoExtractRequest;
  try {
    payload = JSON.parse(event.body ?? '{}') as PhotoExtractRequest;
  } catch (err) {
    return jsonResponse(400, {
      error: 'invalid_json',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await handlePhotoExtract(payload, deps);
    return jsonResponse(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isClientError = /required|invalid|forbidden|not.allowed/i.test(message);
    return jsonResponse(isClientError ? 400 : 500, {
      error: isClientError ? 'invalid_request' : 'internal_error',
      message,
    });
  }
}

export async function handler(
  event: PhotoExtractRequest | ApiGatewayProxyEvent,
): Promise<PhotoExtractResponse | ApiGatewayProxyResponse> {
  const deps = buildDeps();
  if (isProxyEvent(event)) {
    return handleProxyInvocation(event, deps);
  }
  return handlePhotoExtract(event, deps);
}
