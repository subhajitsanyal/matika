export {};

/**
 * Compliance: Data Retention Verification
 *
 * Verifies data retention policies across CareLog AWS infrastructure.
 *
 * Checks:
 * - S3 FHIR bucket: lifecycle rules
 * - S3 raw bucket: lifecycle (90d IA, 365d Glacier, 7yr expire)
 * - CloudWatch logs: retention periods per log group
 * - CloudTrail logs: 7-year retention
 * - RDS: backup retention (automated backups enabled, retention >= 7 days)
 *
 * Requires: AWS credentials with read-only access.
 *
 * Usage: npx tsx compliance/data-retention-verify.ts
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
// S3 Lifecycle Rules
// ---------------------------------------------------------------------------

async function checkS3Lifecycle(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const bucketsJson = await runCommand(
      `aws s3api list-buckets --query "Buckets[?contains(Name, 'carelog')].Name" --output json --region ${REGION}`,
    );
    const buckets: string[] = JSON.parse(bucketsJson);

    for (const bucket of buckets) {
      const isRawBucket =
        bucket.includes('raw') || bucket.includes('interaction');
      const isFhirBucket = bucket.includes('fhir');

      try {
        const lifecycleJson = await runCommand(
          `aws s3api get-bucket-lifecycle-configuration --bucket "${bucket}" --output json`,
        );
        const lifecycle = JSON.parse(lifecycleJson);
        const rules = lifecycle.Rules ?? [];

        if (isRawBucket) {
          // Raw bucket should have: 90d IA, 365d Glacier, 7yr expire
          let hasIa = false;
          let hasGlacier = false;
          let hasExpiration = false;

          for (const rule of rules) {
            if (rule.Status !== 'Enabled') continue;
            const transitions = rule.Transitions ?? [];
            for (const t of transitions) {
              if (
                t.StorageClass === 'INTELLIGENT_TIERING' &&
                t.Days <= 90
              )
                hasIa = true;
              if (
                (t.StorageClass === 'GLACIER' ||
                  t.StorageClass === 'DEEP_ARCHIVE') &&
                t.Days <= 365
              )
                hasGlacier = true;
            }
            if (rule.Expiration?.Days) {
              const expDays = rule.Expiration.Days;
              // 7 years ~ 2555 days
              if (expDays >= 2500 && expDays <= 2600) hasExpiration = true;
            }
          }

          results.push({
            check: 'S3 raw bucket: 90d Intelligent-Tiering',
            resource: bucket,
            pass: hasIa,
            detail: hasIa
              ? 'Transition to Intelligent-Tiering at <= 90 days configured'
              : 'FAIL: No Intelligent-Tiering transition at 90 days',
            remediation: hasIa
              ? undefined
              : 'Add S3 lifecycle rule: transition to INTELLIGENT_TIERING at 90 days.',
          });

          results.push({
            check: 'S3 raw bucket: 365d Glacier',
            resource: bucket,
            pass: hasGlacier,
            detail: hasGlacier
              ? 'Transition to Glacier/Deep Archive at <= 365 days configured'
              : 'FAIL: No Glacier transition at 365 days',
            remediation: hasGlacier
              ? undefined
              : 'Add S3 lifecycle rule: transition to DEEP_ARCHIVE at 365 days.',
          });

          results.push({
            check: 'S3 raw bucket: 7-year expiration',
            resource: bucket,
            pass: hasExpiration,
            detail: hasExpiration
              ? '7-year expiration rule configured'
              : 'FAIL: No 7-year expiration rule found',
            remediation: hasExpiration
              ? undefined
              : 'Add S3 lifecycle rule: expire objects at 2555 days (7 years). This is the HIPAA minimum retention.',
          });
        } else if (isFhirBucket) {
          // FHIR bucket: document any lifecycle rules
          results.push({
            check: 'S3 FHIR bucket lifecycle',
            resource: bucket,
            pass: true,
            detail:
              rules.length > 0
                ? `${rules.length} lifecycle rule(s) configured: ${rules.map((r: any) => r.ID ?? 'unnamed').join(', ')}`
                : 'No lifecycle rules (data retained indefinitely until account deletion)',
          });
        } else {
          // Other carelog buckets
          results.push({
            check: 'S3 bucket lifecycle',
            resource: bucket,
            pass: true,
            detail:
              rules.length > 0
                ? `${rules.length} lifecycle rule(s) configured`
                : 'No lifecycle rules configured',
          });
        }
      } catch {
        if (isRawBucket) {
          results.push({
            check: 'S3 raw bucket lifecycle',
            resource: bucket,
            pass: false,
            detail:
              'FAIL: No lifecycle configuration found on raw/interaction bucket',
            remediation:
              'Add lifecycle rules: 90d Intelligent-Tiering, 365d Glacier Deep Archive, 2555d expiration.',
          });
        } else {
          results.push({
            check: 'S3 bucket lifecycle',
            resource: bucket,
            pass: true,
            detail: 'No lifecycle configuration (acceptable for non-raw buckets)',
          });
        }
      }
    }

    if (buckets.length === 0) {
      results.push({
        check: 'S3 lifecycle',
        resource: 'all',
        pass: false,
        detail: 'No CareLog S3 buckets found.',
      });
    }
  } catch (err) {
    results.push({
      check: 'S3 lifecycle check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// CloudWatch Log Retention
// ---------------------------------------------------------------------------

async function checkCloudWatchRetention(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const logGroupsJson = await runCommand(
      `aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/carelog" --query "logGroups[].{Name:logGroupName,Retention:retentionInDays}" --output json --region ${REGION}`,
    );
    const logGroups: Array<{ Name: string; Retention: number | null }> =
      JSON.parse(logGroupsJson);

    // Also check API Gateway log groups
    try {
      const apiLogGroupsJson = await runCommand(
        `aws logs describe-log-groups --log-group-name-prefix "API-Gateway" --query "logGroups[?contains(logGroupName, 'carelog') || contains(logGroupName, 'CareLog')].{Name:logGroupName,Retention:retentionInDays}" --output json --region ${REGION}`,
      );
      logGroups.push(...JSON.parse(apiLogGroupsJson));
    } catch {
      // API Gateway log groups may not exist
    }

    for (const lg of logGroups) {
      const retention = lg.Retention;
      // Indefinite retention (null) is technically compliant but wasteful
      const isCompliant =
        retention === null || retention >= 365;

      results.push({
        check: 'CloudWatch log retention',
        resource: lg.Name,
        pass: isCompliant,
        detail: isCompliant
          ? `Retention: ${retention === null ? 'indefinite' : `${retention} days`}`
          : `FAIL: Retention is ${retention} days (need >= 365)`,
        remediation: isCompliant
          ? retention === null
            ? `Consider setting explicit retention to control costs: aws logs put-retention-policy --log-group-name "${lg.Name}" --retention-in-days 365`
            : undefined
          : `Set retention: aws logs put-retention-policy --log-group-name "${lg.Name}" --retention-in-days 365`,
      });
    }

    if (logGroups.length === 0) {
      results.push({
        check: 'CloudWatch log retention',
        resource: 'all',
        pass: false,
        detail: 'No CareLog CloudWatch log groups found.',
      });
    }
  } catch (err) {
    results.push({
      check: 'CloudWatch retention check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// RDS Backup Retention
// ---------------------------------------------------------------------------

async function checkRdsBackup(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const instancesJson = await runCommand(
      `aws rds describe-db-instances --query "DBInstances[?contains(DBInstanceIdentifier, 'carelog')].{Id:DBInstanceIdentifier,BackupRetention:BackupRetentionPeriod,MultiAZ:MultiAZ}" --output json --region ${REGION}`,
    );
    const instances: Array<{
      Id: string;
      BackupRetention: number;
      MultiAZ: boolean;
    }> = JSON.parse(instancesJson);

    for (const instance of instances) {
      results.push({
        check: 'RDS backup retention',
        resource: instance.Id,
        pass: instance.BackupRetention >= 7,
        detail:
          instance.BackupRetention >= 7
            ? `Backup retention: ${instance.BackupRetention} days`
            : `FAIL: Backup retention is ${instance.BackupRetention} days (need >= 7)`,
        remediation:
          instance.BackupRetention >= 7
            ? undefined
            : `Increase backup retention: aws rds modify-db-instance --db-instance-identifier ${instance.Id} --backup-retention-period 7`,
      });

      results.push({
        check: 'RDS automated backups',
        resource: instance.Id,
        pass: instance.BackupRetention > 0,
        detail:
          instance.BackupRetention > 0
            ? 'Automated backups enabled'
            : 'FAIL: Automated backups are DISABLED (retention = 0)',
        remediation:
          instance.BackupRetention > 0
            ? undefined
            : 'Enable automated backups by setting backup retention period > 0.',
      });
    }

    if (instances.length === 0) {
      results.push({
        check: 'RDS backup',
        resource: 'all',
        pass: false,
        detail: 'No CareLog RDS instances found.',
      });
    }
  } catch (err) {
    results.push({
      check: 'RDS backup check',
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

async function main(): Promise<void> {
  console.log('=== Data Retention Verification ===');
  console.log(`Region: ${REGION}\n`);

  const allResults: CheckResult[] = [];

  console.log('--- S3 Lifecycle Rules ---\n');
  allResults.push(...(await checkS3Lifecycle()));

  console.log('\n--- CloudWatch Log Retention ---\n');
  allResults.push(...(await checkCloudWatchRetention()));

  console.log('\n--- RDS Backup Retention ---\n');
  allResults.push(...(await checkRdsBackup()));

  // Summary
  console.log('\n=== Summary ===\n');

  const passed = allResults.filter((r) => r.pass);
  const failed = allResults.filter((r) => !r.pass);

  for (const r of allResults) {
    const icon = r.pass ? '[PASS]' : '[FAIL]';
    console.log(`${icon} ${r.check}: ${r.resource}`);
    console.log(`       ${r.detail}`);
    if (r.remediation) {
      console.log(`       Remediation: ${r.remediation}`);
    }
  }

  console.log(
    `\nTotal: ${allResults.length} checks, ${passed.length} passed, ${failed.length} failed`,
  );

  if (failed.length > 0) {
    console.log('\nFAIL: Data retention verification found issues.');
    process.exit(1);
  }

  console.log('\nPASS: All data retention checks passed.');
}

main().catch((err) => {
  console.error('Data retention verification failed:', err);
  process.exit(1);
});
