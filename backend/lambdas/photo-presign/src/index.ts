// Lambda entry. API Gateway proxy event unwrap matches the pattern in
// bedrock-router/src/index.ts.

import { S3Client } from '@aws-sdk/client-s3';
import { handlePresign, PresignRequest, PresignResponse, HandlerDeps, HandlerError } from './handler';

let _deps: HandlerDeps | null = null;

function buildDeps(): HandlerDeps {
  if (_deps) return _deps;
  const region = process.env.AWS_REGION ?? 'ap-south-1';
  const bucket = process.env.RAW_INTERACTIONS_BUCKET;
  if (!bucket) throw new Error('RAW_INTERACTIONS_BUCKET environment variable not set');
  _deps = { s3: new S3Client({ region }), bucket };
  return _deps;
}

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
    !('patientId' in event)
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
  let payload: PresignRequest;
  try {
    payload = JSON.parse(event.body ?? '{}') as PresignRequest;
  } catch (err) {
    return jsonResponse(400, {
      error: 'invalid_json',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await handlePresign(payload, deps);
    return jsonResponse(200, result);
  } catch (err) {
    if (err instanceof HandlerError) {
      return jsonResponse(err.statusCode, { error: err.code, message: err.message });
    }
    console.error('photo-presign failed', err);
    return jsonResponse(500, {
      error: 'internal_error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handler(
  event: PresignRequest | ApiGatewayProxyEvent,
): Promise<PresignResponse | ApiGatewayProxyResponse> {
  const deps = buildDeps();
  if (isProxyEvent(event)) {
    return handleProxyInvocation(event, deps);
  }
  return handlePresign(event, deps);
}
