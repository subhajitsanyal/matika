// Runtime fetch of the RDS master credentials from Secrets Manager.
// See bedrock-router/src/db_secret.ts for the full rationale — this is a
// near-verbatim copy because Lambdas don't share a node_modules tree.

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Pool } from 'pg';

interface DbCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  dbname: string;
}

let _pool: Pool | null = null;

async function fetchDbCredentials(): Promise<DbCredentials> {
  const secretArn = process.env.DB_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DB_SECRET_ARN environment variable not set');
  }
  const region = process.env.AWS_REGION ?? 'ap-south-1';
  const client = new SecretsManagerClient({ region });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!response.SecretString) {
    throw new Error(`Secret ${secretArn} has empty SecretString`);
  }
  const parsed = JSON.parse(response.SecretString);
  if (!parsed.host || !parsed.port || !parsed.username || !parsed.password || !parsed.dbname) {
    throw new Error(`Secret ${secretArn} missing one or more required fields (host/port/username/password/dbname)`);
  }
  return {
    host: parsed.host,
    port: typeof parsed.port === 'string' ? parseInt(parsed.port, 10) : parsed.port,
    username: parsed.username,
    password: parsed.password,
    dbname: parsed.dbname,
  };
}

export async function getPgPool(): Promise<Pool> {
  if (_pool) return _pool;
  const creds = await fetchDbCredentials();
  _pool = new Pool({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password,
    database: creds.dbname,
    max: 1,
    ssl: { rejectUnauthorized: false },
  });
  return _pool;
}
