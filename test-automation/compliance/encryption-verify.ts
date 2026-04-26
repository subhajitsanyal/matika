export {};

/**
 * Compliance: Encryption Verification
 *
 * Verifies encryption at rest and in transit for all CareLog AWS resources.
 *
 * Checks:
 * - S3 buckets: SSE-KMS enabled on FHIR and raw buckets
 * - S3 bucket policy: TLS enforcement (deny aws:SecureTransport=false)
 * - RDS: storage encryption enabled
 * - RDS: TLS connections enforced (rds.force_ssl)
 * - KMS: key auto-rotation enabled
 * - SQS: encryption at rest (KmsMasterKeyId)
 *
 * Requires: AWS credentials with read-only access.
 *
 * Usage: npx tsx compliance/encryption-verify.ts
 */

const REGION = 'ap-south-1';

interface CheckResult {
  check: string;
  resource: string;
  pass: boolean;
  detail: string;
  remediation?: string;
}

async function runCommand(command: string): Promise<string> {
  const { exec } = await import('child_process');
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${command} failed: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// S3 Encryption Checks
// ---------------------------------------------------------------------------

async function checkS3Encryption(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const bucketsJson = await runCommand(
      `aws s3api list-buckets --query "Buckets[?contains(Name, 'carelog')].Name" --output json --region ${REGION}`,
    );
    const buckets: string[] = JSON.parse(bucketsJson);

    for (const bucket of buckets) {
      // Check SSE-KMS encryption
      try {
        const encJson = await runCommand(
          `aws s3api get-bucket-encryption --bucket ${bucket} --output json`,
        );
        const enc = JSON.parse(encJson);
        const rules = enc.ServerSideEncryptionConfiguration?.Rules ?? [];
        const kmsRule = rules.find(
          (r: any) =>
            r.ApplyServerSideEncryptionByDefault?.SSEAlgorithm === 'aws:kms',
        );

        results.push({
          check: 'S3 SSE-KMS encryption',
          resource: bucket,
          pass: !!kmsRule,
          detail: kmsRule
            ? `SSE-KMS enabled with key ${kmsRule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID ?? 'default'}`
            : `FAIL: SSE-KMS not configured. Algorithm: ${rules[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm ?? 'none'}`,
          remediation: kmsRule
            ? undefined
            : 'Enable SSE-KMS on the bucket via aws s3api put-bucket-encryption or Terraform aws_s3_bucket_server_side_encryption_configuration',
        });
      } catch (err) {
        results.push({
          check: 'S3 SSE-KMS encryption',
          resource: bucket,
          pass: false,
          detail: `FAIL: No encryption configuration found — ${err instanceof Error ? err.message : String(err)}`,
          remediation:
            'Enable SSE-KMS encryption on this bucket. Add aws_s3_bucket_server_side_encryption_configuration in Terraform.',
        });
      }

      // Check TLS enforcement in bucket policy
      try {
        const policyJson = await runCommand(
          `aws s3api get-bucket-policy --bucket ${bucket} --output json`,
        );
        const policyDoc = JSON.parse(JSON.parse(policyJson).Policy);
        const statements = policyDoc.Statement ?? [];
        const tlsDeny = statements.find(
          (s: any) =>
            s.Effect === 'Deny' &&
            s.Condition?.Bool?.['aws:SecureTransport'] === 'false',
        );

        results.push({
          check: 'S3 TLS enforcement (bucket policy)',
          resource: bucket,
          pass: !!tlsDeny,
          detail: tlsDeny
            ? 'Bucket policy denies non-TLS requests'
            : 'FAIL: No TLS enforcement in bucket policy',
          remediation: tlsDeny
            ? undefined
            : 'Add a Deny statement with Condition {"Bool": {"aws:SecureTransport": "false"}} to the bucket policy.',
        });
      } catch {
        results.push({
          check: 'S3 TLS enforcement (bucket policy)',
          resource: bucket,
          pass: false,
          detail: 'FAIL: No bucket policy found (TLS not enforced)',
          remediation:
            'Create a bucket policy that denies requests where aws:SecureTransport is false.',
        });
      }

      // Check public access block
      try {
        const pubJson = await runCommand(
          `aws s3api get-public-access-block --bucket ${bucket} --output json`,
        );
        const pub = JSON.parse(pubJson).PublicAccessBlockConfiguration;
        const allBlocked =
          pub.BlockPublicAcls &&
          pub.IgnorePublicAcls &&
          pub.BlockPublicPolicy &&
          pub.RestrictPublicBuckets;

        results.push({
          check: 'S3 public access block',
          resource: bucket,
          pass: allBlocked,
          detail: allBlocked
            ? 'All 4 public access block settings enabled'
            : `FAIL: Public access block incomplete — BlockPublicAcls=${pub.BlockPublicAcls}, IgnorePublicAcls=${pub.IgnorePublicAcls}, BlockPublicPolicy=${pub.BlockPublicPolicy}, RestrictPublicBuckets=${pub.RestrictPublicBuckets}`,
          remediation: allBlocked
            ? undefined
            : 'Enable all 4 public access block settings via aws s3api put-public-access-block or Terraform aws_s3_bucket_public_access_block.',
        });
      } catch {
        results.push({
          check: 'S3 public access block',
          resource: bucket,
          pass: false,
          detail: 'FAIL: Could not retrieve public access block settings',
          remediation:
            'Enable public access block on the bucket with all 4 settings set to true.',
        });
      }
    }

    if (buckets.length === 0) {
      results.push({
        check: 'S3 bucket discovery',
        resource: 'all',
        pass: false,
        detail: 'No CareLog S3 buckets found. Verify bucket naming convention includes "carelog".',
      });
    }
  } catch (err) {
    results.push({
      check: 'S3 bucket listing',
      resource: 'all',
      pass: false,
      detail: `Failed to list buckets: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// RDS Encryption Checks
// ---------------------------------------------------------------------------

async function checkRdsEncryption(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const instancesJson = await runCommand(
      `aws rds describe-db-instances --query "DBInstances[?contains(DBInstanceIdentifier, 'carelog')].{Id:DBInstanceIdentifier,Encrypted:StorageEncrypted,KmsKeyId:KmsKeyId,PubliclyAccessible:PubliclyAccessible}" --output json --region ${REGION}`,
    );
    const instances: Array<{
      Id: string;
      Encrypted: boolean;
      KmsKeyId: string;
      PubliclyAccessible: boolean;
    }> = JSON.parse(instancesJson);

    for (const instance of instances) {
      results.push({
        check: 'RDS storage encryption',
        resource: instance.Id,
        pass: instance.Encrypted,
        detail: instance.Encrypted
          ? `Encrypted with KMS key: ${instance.KmsKeyId}`
          : 'FAIL: Storage encryption is NOT enabled',
        remediation: instance.Encrypted
          ? undefined
          : 'RDS encryption at rest must be enabled at creation time. Migrate to a new encrypted instance.',
      });

      results.push({
        check: 'RDS public accessibility',
        resource: instance.Id,
        pass: !instance.PubliclyAccessible,
        detail: instance.PubliclyAccessible
          ? 'FAIL: RDS instance is publicly accessible'
          : 'RDS instance is not publicly accessible',
        remediation: instance.PubliclyAccessible
          ? 'Modify the RDS instance to disable public accessibility. Update Terraform: publicly_accessible = false.'
          : undefined,
      });
    }

    // Check force_ssl parameter
    try {
      const paramGroupsJson = await runCommand(
        `aws rds describe-db-instances --query "DBInstances[?contains(DBInstanceIdentifier, 'carelog')].{Id:DBInstanceIdentifier,ParamGroup:DBParameterGroups[0].DBParameterGroupName}" --output json --region ${REGION}`,
      );
      const paramGroups: Array<{ Id: string; ParamGroup: string }> =
        JSON.parse(paramGroupsJson);

      for (const pg of paramGroups) {
        try {
          const sslParamJson = await runCommand(
            `aws rds describe-db-parameters --db-parameter-group-name "${pg.ParamGroup}" --query "Parameters[?ParameterName=='rds.force_ssl'].{Name:ParameterName,Value:ParameterValue}" --output json --region ${REGION}`,
          );
          const sslParams: Array<{ Name: string; Value: string }> =
            JSON.parse(sslParamJson);
          const forceSsl = sslParams[0]?.Value === '1';

          results.push({
            check: 'RDS force SSL',
            resource: `${pg.Id} (${pg.ParamGroup})`,
            pass: forceSsl,
            detail: forceSsl
              ? 'rds.force_ssl = 1 (TLS connections enforced)'
              : `FAIL: rds.force_ssl = ${sslParams[0]?.Value ?? 'not set'}`,
            remediation: forceSsl
              ? undefined
              : 'Set rds.force_ssl = 1 in the RDS parameter group. Update Terraform: parameter { name = "rds.force_ssl" value = "1" }',
          });
        } catch {
          results.push({
            check: 'RDS force SSL',
            resource: pg.Id,
            pass: false,
            detail: 'FAIL: Could not read parameter group',
          });
        }
      }
    } catch {
      results.push({
        check: 'RDS force SSL',
        resource: 'all',
        pass: false,
        detail: 'FAIL: Could not retrieve RDS parameter groups',
      });
    }

    if (instances.length === 0) {
      results.push({
        check: 'RDS instance discovery',
        resource: 'all',
        pass: false,
        detail: 'No CareLog RDS instances found.',
      });
    }
  } catch (err) {
    results.push({
      check: 'RDS encryption check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// KMS Key Rotation Check
// ---------------------------------------------------------------------------

async function checkKmsKeyRotation(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const aliasesJson = await runCommand(
      `aws kms list-aliases --query "Aliases[?contains(AliasName, 'carelog')].{Alias:AliasName,KeyId:TargetKeyId}" --output json --region ${REGION}`,
    );
    const aliases: Array<{ Alias: string; KeyId: string }> =
      JSON.parse(aliasesJson);

    for (const alias of aliases) {
      try {
        const rotationJson = await runCommand(
          `aws kms get-key-rotation-status --key-id "${alias.KeyId}" --output json --region ${REGION}`,
        );
        const rotation = JSON.parse(rotationJson);

        results.push({
          check: 'KMS key auto-rotation',
          resource: `${alias.Alias} (${alias.KeyId})`,
          pass: rotation.KeyRotationEnabled,
          detail: rotation.KeyRotationEnabled
            ? 'Auto-rotation enabled'
            : 'FAIL: Auto-rotation is NOT enabled',
          remediation: rotation.KeyRotationEnabled
            ? undefined
            : 'Enable key rotation: aws kms enable-key-rotation --key-id <key-id> or Terraform: enable_key_rotation = true',
        });
      } catch {
        results.push({
          check: 'KMS key auto-rotation',
          resource: alias.Alias,
          pass: false,
          detail: 'FAIL: Could not check rotation status',
        });
      }
    }

    if (aliases.length === 0) {
      results.push({
        check: 'KMS key discovery',
        resource: 'all',
        pass: false,
        detail: 'No CareLog KMS key aliases found. Verify alias naming includes "carelog".',
      });
    }
  } catch (err) {
    results.push({
      check: 'KMS key rotation',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// SQS Encryption Check
// ---------------------------------------------------------------------------

async function checkSqsEncryption(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const queuesJson = await runCommand(
      `aws sqs list-queues --queue-name-prefix carelog --output json --region ${REGION}`,
    );
    const parsed = JSON.parse(queuesJson);
    const queueUrls: string[] = parsed.QueueUrls ?? [];

    for (const queueUrl of queueUrls) {
      try {
        const attrsJson = await runCommand(
          `aws sqs get-queue-attributes --queue-url "${queueUrl}" --attribute-names KmsMasterKeyId SqsManagedSseEnabled --output json --region ${REGION}`,
        );
        const attrs = JSON.parse(attrsJson).Attributes ?? {};
        const hasKms = !!attrs.KmsMasterKeyId;
        const hasSse = attrs.SqsManagedSseEnabled === 'true';
        const encrypted = hasKms || hasSse;

        const queueName = queueUrl.split('/').pop();

        results.push({
          check: 'SQS encryption at rest',
          resource: queueName ?? queueUrl,
          pass: encrypted,
          detail: hasKms
            ? `KMS encryption with key: ${attrs.KmsMasterKeyId}`
            : hasSse
              ? 'SQS-managed SSE enabled'
              : 'FAIL: No encryption at rest configured',
          remediation: encrypted
            ? undefined
            : 'Enable KMS encryption on the SQS queue via aws sqs set-queue-attributes or Terraform: kms_master_key_id',
        });
      } catch {
        const queueName = queueUrl.split('/').pop();
        results.push({
          check: 'SQS encryption at rest',
          resource: queueName ?? queueUrl,
          pass: false,
          detail: 'FAIL: Could not retrieve queue attributes',
        });
      }
    }

    if (queueUrls.length === 0) {
      results.push({
        check: 'SQS queue discovery',
        resource: 'all',
        pass: false,
        detail: 'No CareLog SQS queues found. Verify queue naming includes "carelog".',
      });
    }
  } catch (err) {
    results.push({
      check: 'SQS encryption',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printResults(results: CheckResult[]): void {
  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass);

  for (const r of results) {
    const icon = r.pass ? '[PASS]' : '[FAIL]';
    console.log(`${icon} ${r.check}: ${r.resource}`);
    console.log(`       ${r.detail}`);
    if (r.remediation) {
      console.log(`       Remediation: ${r.remediation}`);
    }
  }

  console.log(
    `\nTotal: ${results.length} checks, ${passed.length} passed, ${failed.length} failed`,
  );

  return;
}

async function main(): Promise<void> {
  console.log('=== Encryption Verification ===');
  console.log(`Region: ${REGION}\n`);

  const allResults: CheckResult[] = [];

  console.log('--- S3 Encryption ---\n');
  const s3Results = await checkS3Encryption();
  allResults.push(...s3Results);

  console.log('\n--- RDS Encryption ---\n');
  const rdsResults = await checkRdsEncryption();
  allResults.push(...rdsResults);

  console.log('\n--- KMS Key Rotation ---\n');
  const kmsResults = await checkKmsKeyRotation();
  allResults.push(...kmsResults);

  console.log('\n--- SQS Encryption ---\n');
  const sqsResults = await checkSqsEncryption();
  allResults.push(...sqsResults);

  console.log('\n=== Summary ===\n');
  printResults(allResults);

  const failed = allResults.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log('\nFAIL: Encryption verification found issues.');
    process.exit(1);
  }

  console.log('\nPASS: All encryption checks passed.');
}

main().catch((err) => {
  console.error('Encryption verification failed:', err);
  process.exit(1);
});
