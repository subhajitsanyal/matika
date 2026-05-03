// Runtime fetch of the RDS master credentials from Secrets Manager.
//
// Why not env vars: when Terraform plumbs PGHOST/PGPASSWORD/etc. as Lambda
// environment variables, anyone with `lambda:GetFunctionConfiguration`
// permission can read the password in plaintext. Fetching at cold-start
// keeps the secret in the Lambda's memory only — it never appears in IAM
// listings or CloudFormation/Terraform-rendered config.
//
// Caching: the credentials are fetched once per cold start and held in
// module scope. Warm invocations reuse the cached pool. Secret rotation
// is therefore picked up only on the next cold start (acceptable for
// v2.0 because no automatic rotation policy is configured yet — flag for
// re-evaluation when one is added).

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

// Cold-start cost: ~150–250 ms for the Secrets Manager fetch + pool init.
// Warm invocations skip this entirely.
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
    // RDS PostgreSQL 15 enforces SSL on incoming connections (rds.force_ssl).
    // We accept the AWS-issued cert without verify-full in v2.0; bundling
    // the AWS RDS CA bundle is a follow-up.
    ssl: { rejectUnauthorized: false },
  });
  return _pool;
}
