/**
 * Compliance: Data Localisation Verification
 *
 * Verifies that all AWS resources storing patient data are in ap-south-1
 * (India) per DPDP Act data residency requirements.
 *
 * Checks:
 * - All S3 buckets are in ap-south-1
 * - RDS instances are in ap-south-1
 * - No cross-region replication configured
 *
 * Requires: AWS credentials with read-only access.
 *
 * Usage: tsx compliance/data-localisation-verify.ts
 */

import { ENV } from '../e2e/helpers/test-data';

const REQUIRED_REGION = 'ap-south-1';

interface CheckResult {
  check: string;
  resource: string;
  region: string;
  pass: boolean;
  detail: string;
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

async function checkS3Buckets(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const bucketsJson = await runCommand(
      `aws s3api list-buckets --query "Buckets[?contains(Name, 'carelog')].Name" --output json --region ${REQUIRED_REGION}`,
    );
    const buckets: string[] = JSON.parse(bucketsJson);

    for (const bucket of buckets) {
      try {
        const locationJson = await runCommand(
          `aws s3api get-bucket-location --bucket ${bucket} --output json`,
        );
        const location = JSON.parse(locationJson);
        // AWS returns null for us-east-1, otherwise the region string
        const region = location.LocationConstraint || 'us-east-1';

        results.push({
          check: 'S3 bucket region',
          resource: bucket,
          region,
          pass: region === REQUIRED_REGION,
          detail: region === REQUIRED_REGION
            ? `Bucket in ${REQUIRED_REGION}`
            : `VIOLATION: Bucket in ${region}, expected ${REQUIRED_REGION}`,
        });

        // Check for cross-region replication
        try {
          await runCommand(
            `aws s3api get-bucket-replication --bucket ${bucket} --output json`,
          );
          results.push({
            check: 'S3 cross-region replication',
            resource: bucket,
            region: 'multiple',
            pass: false,
            detail: 'VIOLATION: Cross-region replication is configured',
          });
        } catch {
          results.push({
            check: 'S3 cross-region replication',
            resource: bucket,
            region: REQUIRED_REGION,
            pass: true,
            detail: 'No cross-region replication configured',
          });
        }
      } catch (err) {
        results.push({
          check: 'S3 bucket region',
          resource: bucket,
          region: 'unknown',
          pass: false,
          detail: `Failed to check: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  } catch (err) {
    results.push({
      check: 'S3 bucket listing',
      resource: 'all',
      region: 'unknown',
      pass: false,
      detail: `Failed to list buckets: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

async function checkRdsInstances(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const instancesJson = await runCommand(
      `aws rds describe-db-instances --query "DBInstances[?contains(DBInstanceIdentifier, 'carelog')].{Id:DBInstanceIdentifier,Region:AvailabilityZone}" --output json --region ${REQUIRED_REGION}`,
    );
    const instances: Array<{ Id: string; Region: string }> = JSON.parse(instancesJson);

    for (const instance of instances) {
      const region = instance.Region.replace(/[a-z]$/, ''); // Remove AZ suffix
      results.push({
        check: 'RDS instance region',
        resource: instance.Id,
        region,
        pass: region === REQUIRED_REGION,
        detail: region === REQUIRED_REGION
          ? `RDS in ${REQUIRED_REGION}`
          : `VIOLATION: RDS in ${region}, expected ${REQUIRED_REGION}`,
      });
    }

    // Check for read replicas in other regions
    try {
      const allRegionsJson = await runCommand(
        `aws ec2 describe-regions --query "Regions[].RegionName" --output json`,
      );
      const allRegions: string[] = JSON.parse(allRegionsJson);

      for (const region of allRegions) {
        if (region === REQUIRED_REGION) continue;

        try {
          const replicasJson = await runCommand(
            `aws rds describe-db-instances --query "DBInstances[?contains(DBInstanceIdentifier, 'carelog')].DBInstanceIdentifier" --output json --region ${region}`,
          );
          const replicas: string[] = JSON.parse(replicasJson);
          if (replicas.length > 0) {
            results.push({
              check: 'RDS cross-region replica',
              resource: replicas.join(', '),
              region,
              pass: false,
              detail: `VIOLATION: RDS instances found in ${region}`,
            });
          }
        } catch {
          // Ignore regions where we have no access
        }
      }
    } catch {
      results.push({
        check: 'RDS cross-region check',
        resource: 'all',
        region: 'unknown',
        pass: false,
        detail: 'Could not enumerate regions to check for cross-region replicas',
      });
    }
  } catch (err) {
    results.push({
      check: 'RDS instance listing',
      resource: 'all',
      region: 'unknown',
      pass: false,
      detail: `Failed to list RDS instances: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

async function main(): Promise<void> {
  console.log('=== Data Localisation Verification ===');
  console.log(`Required region: ${REQUIRED_REGION}\n`);

  const allResults: CheckResult[] = [];

  console.log('Checking S3 buckets...');
  allResults.push(...(await checkS3Buckets()));

  console.log('Checking RDS instances...');
  allResults.push(...(await checkRdsInstances()));

  // Report
  console.log('\n--- Results ---\n');

  const passed = allResults.filter((r) => r.pass);
  const failed = allResults.filter((r) => !r.pass);

  for (const r of allResults) {
    const icon = r.pass ? '[PASS]' : '[FAIL]';
    console.log(`${icon} ${r.check}: ${r.resource} — ${r.detail}`);
  }

  console.log(`\nTotal: ${allResults.length} checks, ${passed.length} passed, ${failed.length} failed`);

  if (failed.length > 0) {
    console.log('\nVIOLATIONS:');
    for (const f of failed) {
      console.log(`  - ${f.resource}: ${f.detail}`);
    }
    process.exit(1);
  }

  console.log('\nAll data localisation checks passed.');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
