// Lambda entry point.
// Constructs the dependency graph (Bedrock client, pg pool, loaders) on cold
// start and exposes a single `handler(event)` that AWS Lambda invokes.
//
// Test harnesses bypass this file and import `handleTurn` from handler.ts
// directly with their own mocks.

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { Pool } from 'pg';
import { resolve as resolvePath } from 'node:path';

import { handleTurn, TurnRequest, TurnResponse, HandlerDeps } from './handler';
import { AwsBedrockInvoker } from './bedrock_client';
import {
  PgPatientContextLoader,
  PgTurnContextLoader,
  PgSessionPersister,
  PgModelCallRecorder,
} from './db';

// Cold-start: build deps once, reuse across warm invocations.
let _deps: HandlerDeps | null = null;

function buildDeps(): HandlerDeps {
  if (_deps) return _deps;

  const inferenceRegion = process.env.INFERENCE_PROFILE_REGION ?? 'ap-southeast-1';

  const bedrockClient = new BedrockRuntimeClient({ region: inferenceRegion });
  const bedrock = new AwsBedrockInvoker(bedrockClient);

  // Pg connection — credentials sourced from Secrets Manager via env at
  // deploy time. The actual env-var → connection-string plumbing is owned
  // by devops in `infrastructure/terraform/modules/lambda` (T-V2-023).
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1, // Lambdas should keep a small pool — increment 5 will tune.
  });

  _deps = {
    bedrock,
    patientLoader: new PgPatientContextLoader(pool),
    turnLoader: new PgTurnContextLoader(pool),
    sessionPersister: new PgSessionPersister(pool),
    modelCallRecorder: new PgModelCallRecorder(pool),
    config: {
      haikuModelId: requiredEnv('BEDROCK_HAIKU_MODEL_ID'),
      sonnetModelId: requiredEnv('BEDROCK_SONNET_MODEL_ID'),
      guardrailId: process.env.BEDROCK_GUARDRAIL_ID,
      guardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION,
      inferenceRegion,
      maxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS ?? '1024', 10),
      systemPromptPath: resolvePath(__dirname, '..', 'prompts', 'system_v2.md'),
    },
  };
  return _deps;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable not set: ${name}`);
  }
  return value;
}

export async function handler(event: TurnRequest): Promise<TurnResponse> {
  return handleTurn(event, buildDeps());
}
