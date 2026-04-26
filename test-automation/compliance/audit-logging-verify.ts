/**
 * Compliance: Audit Logging Verification
 *
 * Verifies audit logging configuration across CareLog AWS infrastructure.
 *
 * Checks:
 * - CloudTrail: trail exists, is logging, multi-region
 * - CloudTrail: S3 delivery with Object Lock (immutable, 7-year retention)
 * - CloudTrail: management events + data events for S3
 * - API Gateway: access logging enabled
 * - RDS: PostgreSQL logging enabled (log_statement, log_connections)
 * - Lambda: CloudWatch log groups exist with appropriate retention
 *
 * Requires: AWS credentials with read-only access.
 *
 * Usage: npx tsx compliance/audit-logging-verify.ts
 */

const REGION = 'ap-south-1';
const MIN_LOG_RETENTION_DAYS = 365; // 1 year minimum for Lambda logs
const CLOUDTRAIL_LOG_RETENTION_YEARS = 7;

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
// CloudTrail Checks
// ---------------------------------------------------------------------------

async function checkCloudTrail(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const trailsJson = await runCommand(
      `aws cloudtrail describe-trails --query "trailList[?contains(Name, 'carelog') || contains(Name, 'CareLog') || IsOrganizationTrail==\`true\`]" --output json --region ${REGION}`,
    );
    const trails: Array<{
      Name: string;
      TrailARN: string;
      IsMultiRegionTrail: boolean;
      S3BucketName: string;
      LogFileValidationEnabled: boolean;
      HasInsightSelectors: boolean;
    }> = JSON.parse(trailsJson);

    if (trails.length === 0) {
      // Check all trails if no carelog-specific trail
      const allTrailsJson = await runCommand(
        `aws cloudtrail describe-trails --output json --region ${REGION}`,
      );
      const allTrails = JSON.parse(allTrailsJson).trailList ?? [];
      if (allTrails.length > 0) {
        trails.push(...allTrails);
      }
    }

    if (trails.length === 0) {
      results.push({
        check: 'CloudTrail trail exists',
        resource: 'all',
        pass: false,
        detail: 'FAIL: No CloudTrail trails found',
        remediation: 'Create a CloudTrail trail for the account. Use Terraform aws_cloudtrail resource.',
      });
      return results;
    }

    for (const trail of trails) {
      // Check trail is logging
      try {
        const statusJson = await runCommand(
          `aws cloudtrail get-trail-status --name "${trail.TrailARN}" --output json --region ${REGION}`,
        );
        const status = JSON.parse(statusJson);

        results.push({
          check: 'CloudTrail is logging',
          resource: trail.Name,
          pass: status.IsLogging,
          detail: status.IsLogging
            ? 'Trail is actively logging'
            : 'FAIL: Trail is NOT logging',
          remediation: status.IsLogging
            ? undefined
            : `Start logging: aws cloudtrail start-logging --name ${trail.Name}`,
        });
      } catch {
        results.push({
          check: 'CloudTrail is logging',
          resource: trail.Name,
          pass: false,
          detail: 'FAIL: Could not check trail status',
        });
      }

      // Check multi-region
      results.push({
        check: 'CloudTrail multi-region',
        resource: trail.Name,
        pass: trail.IsMultiRegionTrail,
        detail: trail.IsMultiRegionTrail
          ? 'Multi-region trail enabled'
          : 'FAIL: Trail is single-region only',
        remediation: trail.IsMultiRegionTrail
          ? undefined
          : 'Enable multi-region: aws cloudtrail update-trail --name <trail> --is-multi-region-trail',
      });

      // Check log file validation
      results.push({
        check: 'CloudTrail log file validation',
        resource: trail.Name,
        pass: trail.LogFileValidationEnabled,
        detail: trail.LogFileValidationEnabled
          ? 'Log file integrity validation enabled'
          : 'FAIL: Log file validation is NOT enabled',
        remediation: trail.LogFileValidationEnabled
          ? undefined
          : 'Enable log file validation: aws cloudtrail update-trail --name <trail> --enable-log-file-validation',
      });

      // Check S3 bucket for Object Lock
      if (trail.S3BucketName) {
        try {
          const lockJson = await runCommand(
            `aws s3api get-object-lock-configuration --bucket "${trail.S3BucketName}" --output json`,
          );
          const lockConfig = JSON.parse(lockJson);
          const enabled =
            lockConfig.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled';
          const rule =
            lockConfig.ObjectLockConfiguration?.Rule?.DefaultRetention;
          const retentionYears = rule?.Years ?? 0;

          results.push({
            check: 'CloudTrail S3 Object Lock',
            resource: trail.S3BucketName,
            pass: enabled && retentionYears >= CLOUDTRAIL_LOG_RETENTION_YEARS,
            detail:
              enabled && retentionYears >= CLOUDTRAIL_LOG_RETENTION_YEARS
                ? `Object Lock enabled with ${retentionYears}-year retention`
                : `FAIL: Object Lock ${enabled ? 'enabled' : 'NOT enabled'}, retention: ${retentionYears} years (need ${CLOUDTRAIL_LOG_RETENTION_YEARS})`,
            remediation:
              enabled && retentionYears >= CLOUDTRAIL_LOG_RETENTION_YEARS
                ? undefined
                : `Enable Object Lock with ${CLOUDTRAIL_LOG_RETENTION_YEARS}-year COMPLIANCE retention on the CloudTrail S3 bucket.`,
          });
        } catch {
          results.push({
            check: 'CloudTrail S3 Object Lock',
            resource: trail.S3BucketName,
            pass: false,
            detail: 'FAIL: Object Lock not configured or could not be read',
            remediation: `Enable S3 Object Lock with ${CLOUDTRAIL_LOG_RETENTION_YEARS}-year retention. Note: Object Lock must be enabled at bucket creation.`,
          });
        }
      }

      // Check event selectors (management + S3 data events)
      try {
        const selectorsJson = await runCommand(
          `aws cloudtrail get-event-selectors --trail-name "${trail.TrailARN}" --output json --region ${REGION}`,
        );
        const selectors = JSON.parse(selectorsJson);
        const eventSelectors = selectors.EventSelectors ?? [];
        const advancedSelectors = selectors.AdvancedEventSelectors ?? [];

        let hasManagement = false;
        let hasS3Data = false;

        // Check basic selectors
        for (const sel of eventSelectors) {
          if (sel.IncludeManagementEvents) hasManagement = true;
          const dataResources = sel.DataResources ?? [];
          for (const dr of dataResources) {
            if (dr.Type === 'AWS::S3::Object') hasS3Data = true;
          }
        }

        // Check advanced selectors
        for (const sel of advancedSelectors) {
          const fieldSelectors = sel.FieldSelectors ?? [];
          for (const fs of fieldSelectors) {
            if (
              fs.Field === 'eventCategory' &&
              fs.Equals?.includes('Management')
            )
              hasManagement = true;
            if (
              fs.Field === 'resources.type' &&
              fs.Equals?.includes('AWS::S3::Object')
            )
              hasS3Data = true;
          }
        }

        results.push({
          check: 'CloudTrail management events',
          resource: trail.Name,
          pass: hasManagement,
          detail: hasManagement
            ? 'Management events logging enabled'
            : 'FAIL: Management events not configured',
          remediation: hasManagement
            ? undefined
            : 'Enable management events in CloudTrail event selectors.',
        });

        results.push({
          check: 'CloudTrail S3 data events',
          resource: trail.Name,
          pass: hasS3Data,
          detail: hasS3Data
            ? 'S3 data event logging enabled'
            : 'FAIL: S3 data events not configured',
          remediation: hasS3Data
            ? undefined
            : 'Add S3 data event logging to CloudTrail event selectors for the CareLog buckets.',
        });
      } catch {
        results.push({
          check: 'CloudTrail event selectors',
          resource: trail.Name,
          pass: false,
          detail: 'FAIL: Could not read event selectors',
        });
      }
    }
  } catch (err) {
    results.push({
      check: 'CloudTrail check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// API Gateway Access Logging
// ---------------------------------------------------------------------------

async function checkApiGatewayLogging(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    // Try REST API first
    const apisJson = await runCommand(
      `aws apigateway get-rest-apis --query "items[?contains(name, 'carelog') || contains(name, 'CareLog')].{Id:id,Name:name}" --output json --region ${REGION}`,
    );
    const apis: Array<{ Id: string; Name: string }> = JSON.parse(apisJson);

    for (const api of apis) {
      try {
        const stagesJson = await runCommand(
          `aws apigateway get-stages --rest-api-id "${api.Id}" --query "item[].{Name:stageName,AccessLogSettings:accessLogSettings}" --output json --region ${REGION}`,
        );
        const stages: Array<{
          Name: string;
          AccessLogSettings: { destinationArn?: string } | null;
        }> = JSON.parse(stagesJson);

        for (const stage of stages) {
          const hasLogging = !!stage.AccessLogSettings?.destinationArn;
          results.push({
            check: 'API Gateway access logging',
            resource: `${api.Name}/${stage.Name}`,
            pass: hasLogging,
            detail: hasLogging
              ? `Access logging to: ${stage.AccessLogSettings!.destinationArn}`
              : 'FAIL: Access logging not configured',
            remediation: hasLogging
              ? undefined
              : 'Enable access logging on the API Gateway stage. Set a CloudWatch log group as destination.',
          });
        }
      } catch {
        results.push({
          check: 'API Gateway access logging',
          resource: api.Name,
          pass: false,
          detail: 'FAIL: Could not read stage configuration',
        });
      }
    }

    // Also check HTTP APIs (v2)
    const httpApisJson = await runCommand(
      `aws apigatewayv2 get-apis --query "Items[?contains(Name, 'carelog') || contains(Name, 'CareLog')].{Id:ApiId,Name:Name}" --output json --region ${REGION}`,
    );
    const httpApis: Array<{ Id: string; Name: string }> =
      JSON.parse(httpApisJson);

    for (const api of httpApis) {
      try {
        const stagesJson = await runCommand(
          `aws apigatewayv2 get-stages --api-id "${api.Id}" --query "Items[].{Name:StageName,AccessLogSettings:AccessLogSettings}" --output json --region ${REGION}`,
        );
        const stages: Array<{
          Name: string;
          AccessLogSettings: { DestinationArn?: string } | null;
        }> = JSON.parse(stagesJson);

        for (const stage of stages) {
          const hasLogging = !!stage.AccessLogSettings?.DestinationArn;
          results.push({
            check: 'API Gateway (HTTP) access logging',
            resource: `${api.Name}/${stage.Name}`,
            pass: hasLogging,
            detail: hasLogging
              ? `Access logging to: ${stage.AccessLogSettings!.DestinationArn}`
              : 'FAIL: Access logging not configured',
            remediation: hasLogging
              ? undefined
              : 'Enable access logging on the HTTP API stage.',
          });
        }
      } catch {
        results.push({
          check: 'API Gateway (HTTP) access logging',
          resource: api.Name,
          pass: false,
          detail: 'FAIL: Could not read stage configuration',
        });
      }
    }
  } catch (err) {
    results.push({
      check: 'API Gateway logging check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// RDS PostgreSQL Logging
// ---------------------------------------------------------------------------

async function checkRdsLogging(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const instancesJson = await runCommand(
      `aws rds describe-db-instances --query "DBInstances[?contains(DBInstanceIdentifier, 'carelog')].{Id:DBInstanceIdentifier,ParamGroup:DBParameterGroups[0].DBParameterGroupName}" --output json --region ${REGION}`,
    );
    const instances: Array<{ Id: string; ParamGroup: string }> =
      JSON.parse(instancesJson);

    for (const instance of instances) {
      const paramsToCheck = ['log_statement', 'log_connections', 'log_disconnections'];

      for (const paramName of paramsToCheck) {
        try {
          const paramJson = await runCommand(
            `aws rds describe-db-parameters --db-parameter-group-name "${instance.ParamGroup}" --query "Parameters[?ParameterName=='${paramName}'].{Name:ParameterName,Value:ParameterValue}" --output json --region ${REGION}`,
          );
          const params: Array<{ Name: string; Value: string }> =
            JSON.parse(paramJson);

          let pass = false;
          let detail = '';
          if (paramName === 'log_statement') {
            pass = params[0]?.Value === 'all' || params[0]?.Value === 'ddl' || params[0]?.Value === 'mod';
            detail = `log_statement = ${params[0]?.Value ?? 'not set'}`;
          } else {
            pass = params[0]?.Value === '1' || params[0]?.Value === 'on';
            detail = `${paramName} = ${params[0]?.Value ?? 'not set'}`;
          }

          results.push({
            check: `RDS ${paramName}`,
            resource: instance.Id,
            pass,
            detail: pass ? detail : `FAIL: ${detail}`,
            remediation: pass
              ? undefined
              : `Set ${paramName} in the RDS parameter group "${instance.ParamGroup}".`,
          });
        } catch {
          results.push({
            check: `RDS ${paramName}`,
            resource: instance.Id,
            pass: false,
            detail: `FAIL: Could not read parameter ${paramName}`,
          });
        }
      }
    }

    if (instances.length === 0) {
      results.push({
        check: 'RDS logging',
        resource: 'all',
        pass: false,
        detail: 'No CareLog RDS instances found.',
      });
    }
  } catch (err) {
    results.push({
      check: 'RDS logging check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Lambda CloudWatch Log Groups
// ---------------------------------------------------------------------------

async function checkLambdaLogGroups(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    // Get all CareLog Lambda functions
    const functionsJson = await runCommand(
      `aws lambda list-functions --query "Functions[?contains(FunctionName, 'carelog')].FunctionName" --output json --region ${REGION}`,
    );
    const functions: string[] = JSON.parse(functionsJson);

    for (const fnName of functions) {
      const logGroupName = `/aws/lambda/${fnName}`;

      try {
        const logGroupJson = await runCommand(
          `aws logs describe-log-groups --log-group-name-prefix "${logGroupName}" --query "logGroups[?logGroupName=='${logGroupName}'].{Name:logGroupName,Retention:retentionInDays}" --output json --region ${REGION}`,
        );
        const logGroups: Array<{ Name: string; Retention: number | null }> =
          JSON.parse(logGroupJson);

        if (logGroups.length === 0) {
          results.push({
            check: 'Lambda CloudWatch log group',
            resource: fnName,
            pass: false,
            detail: `FAIL: Log group ${logGroupName} does not exist`,
            remediation:
              'The log group will be created automatically when the Lambda runs. Verify the Lambda has CloudWatch Logs permissions.',
          });
          continue;
        }

        const retention = logGroups[0].Retention;
        const hasRetention = retention !== null && retention >= MIN_LOG_RETENTION_DAYS;

        results.push({
          check: 'Lambda log group retention',
          resource: fnName,
          pass: hasRetention,
          detail: hasRetention
            ? `Retention: ${retention} days`
            : `FAIL: Retention ${retention === null ? 'is indefinite (never expires)' : `is ${retention} days (need >= ${MIN_LOG_RETENTION_DAYS})`}`,
          remediation: hasRetention
            ? undefined
            : `Set retention: aws logs put-retention-policy --log-group-name "${logGroupName}" --retention-in-days ${MIN_LOG_RETENTION_DAYS}`,
        });
      } catch {
        results.push({
          check: 'Lambda CloudWatch log group',
          resource: fnName,
          pass: false,
          detail: `FAIL: Could not check log group for ${fnName}`,
        });
      }
    }

    if (functions.length === 0) {
      results.push({
        check: 'Lambda log groups',
        resource: 'all',
        pass: false,
        detail: 'No CareLog Lambda functions found.',
      });
    }
  } catch (err) {
    results.push({
      check: 'Lambda log group check',
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
  console.log('=== Audit Logging Verification ===');
  console.log(`Region: ${REGION}\n`);

  const allResults: CheckResult[] = [];

  console.log('--- CloudTrail ---\n');
  allResults.push(...(await checkCloudTrail()));

  console.log('\n--- API Gateway Access Logging ---\n');
  allResults.push(...(await checkApiGatewayLogging()));

  console.log('\n--- RDS PostgreSQL Logging ---\n');
  allResults.push(...(await checkRdsLogging()));

  console.log('\n--- Lambda CloudWatch Log Groups ---\n');
  allResults.push(...(await checkLambdaLogGroups()));

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
    console.log('\nFAIL: Audit logging verification found issues.');
    process.exit(1);
  }

  console.log('\nPASS: All audit logging checks passed.');
}

main().catch((err) => {
  console.error('Audit logging verification failed:', err);
  process.exit(1);
});
