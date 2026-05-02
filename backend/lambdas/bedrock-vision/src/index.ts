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
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

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
      promptPath: resolvePath(__dirname, '..', 'prompts', 'extract_value.md'),
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

export async function handler(event: PhotoExtractRequest): Promise<PhotoExtractResponse> {
  return handlePhotoExtract(event, buildDeps());
}
