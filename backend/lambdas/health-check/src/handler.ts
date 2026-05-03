// GET /health probe handler.
//
// Verifies the three upstream dependencies that bedrock-router and
// bedrock-vision need to function: RDS, Bedrock, and S3. Each probe runs
// in parallel with its own timeout so a stuck dependency can't hang the
// response. The aggregate status is `healthy` only when all three are up;
// any single failure flips to `degraded` and the HTTP status code becomes
// 503 (standard for load-balancer health probes).

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Pool } from 'pg';

export interface HealthCheckResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export type ProbeStatus = 'up' | 'down' | 'unknown';

export interface HealthBody {
  status: 'healthy' | 'degraded';
  checks: {
    rds: ProbeStatus;
    bedrock: ProbeStatus;
    bedrock_inference_region: string | null;
    s3: ProbeStatus;
    lambda_warm: boolean;
  };
  errors?: Record<string, string>;
  timestamp: string;
}

const RDS_TIMEOUT_MS = 3000;
const BEDROCK_TIMEOUT_MS = 5000;
const S3_TIMEOUT_MS = 3000;

// Cold-start: build clients once, reuse across warm invocations. Lambda
// `lambda_warm` is true on every invocation past the first because module-load
// only runs on cold start.
let isWarm = false;

const inferenceRegion = process.env.INFERENCE_PROFILE_REGION ?? 'ap-south-1';
const haikuModelId = process.env.BEDROCK_HAIKU_MODEL_ID;
const rawInteractionsBucket = process.env.RAW_INTERACTIONS_BUCKET;

const bedrockClient = new BedrockRuntimeClient({ region: inferenceRegion });
const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// Pool stays warm across invocations. RDS forces SSL (rds.force_ssl=1)
// — we accept the AWS-issued cert without verify-full as in bedrock-router.
const pool = new Pool({
  max: 1,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: RDS_TIMEOUT_MS,
});

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeRds(): Promise<{ status: ProbeStatus; error?: string }> {
  try {
    await withTimeout(pool.query('SELECT 1'), RDS_TIMEOUT_MS, 'rds');
    return { status: 'up' };
  } catch (e) {
    return { status: 'down', error: (e as Error).message };
  }
}

async function probeBedrock(): Promise<{ status: ProbeStatus; error?: string }> {
  if (!haikuModelId) {
    return { status: 'down', error: 'BEDROCK_HAIKU_MODEL_ID not set' };
  }
  try {
    const cmd = new InvokeModelCommand({
      modelId: haikuModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    await withTimeout(bedrockClient.send(cmd), BEDROCK_TIMEOUT_MS, 'bedrock');
    return { status: 'up' };
  } catch (e) {
    return { status: 'down', error: (e as Error).message };
  }
}

async function probeS3(): Promise<{ status: ProbeStatus; error?: string }> {
  if (!rawInteractionsBucket) {
    return { status: 'down', error: 'RAW_INTERACTIONS_BUCKET not set' };
  }
  try {
    const cmd = new ListObjectsV2Command({ Bucket: rawInteractionsBucket, MaxKeys: 1 });
    await withTimeout(s3Client.send(cmd), S3_TIMEOUT_MS, 's3');
    return { status: 'up' };
  } catch (e) {
    return { status: 'down', error: (e as Error).message };
  }
}

export async function handler(): Promise<HealthCheckResponse> {
  const wasWarm = isWarm;
  isWarm = true;

  const [rds, bedrock, s3] = await Promise.all([probeRds(), probeBedrock(), probeS3()]);

  const allUp = rds.status === 'up' && bedrock.status === 'up' && s3.status === 'up';
  const errors: Record<string, string> = {};
  if (rds.error) errors.rds = rds.error;
  if (bedrock.error) errors.bedrock = bedrock.error;
  if (s3.error) errors.s3 = s3.error;

  const body: HealthBody = {
    status: allUp ? 'healthy' : 'degraded',
    checks: {
      rds: rds.status,
      bedrock: bedrock.status,
      bedrock_inference_region: bedrock.status === 'up' ? inferenceRegion : null,
      s3: s3.status,
      lambda_warm: wasWarm,
    },
    timestamp: new Date().toISOString(),
  };
  if (Object.keys(errors).length > 0) {
    body.errors = errors;
  }

  return {
    statusCode: allUp ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
