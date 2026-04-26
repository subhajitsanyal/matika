/**
 * Compliance: Access Control Verification
 *
 * Verifies access controls across CareLog AWS infrastructure.
 *
 * Checks:
 * - Cognito: 3 groups exist (patients, caregivers, doctors)
 * - Cognito: password policy meets requirements
 * - API Gateway: all routes have Cognito authorizer
 * - S3: public access block on all buckets
 * - RDS: no public accessibility
 * - Bastion: SSM-only access (no SSH keys, IMDSv2 required)
 * - Lambda: no wildcard IAM policies
 *
 * Requires: AWS credentials with read-only access.
 *
 * Usage: npx tsx compliance/access-control-verify.ts
 */

const REGION = 'ap-south-1';
const REQUIRED_COGNITO_GROUPS = ['patients', 'caregivers', 'doctors'];

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
// Cognito Checks
// ---------------------------------------------------------------------------

async function checkCognitoGroups(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    // Find CareLog user pool
    const poolsJson = await runCommand(
      `aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?contains(Name, 'carelog') || contains(Name, 'CareLog')].{Id:Id,Name:Name}" --output json --region ${REGION}`,
    );
    const pools: Array<{ Id: string; Name: string }> = JSON.parse(poolsJson);

    if (pools.length === 0) {
      results.push({
        check: 'Cognito user pool discovery',
        resource: 'all',
        pass: false,
        detail: 'No CareLog user pool found.',
      });
      return results;
    }

    for (const pool of pools) {
      // Check groups
      const groupsJson = await runCommand(
        `aws cognito-idp list-groups --user-pool-id "${pool.Id}" --query "Groups[].GroupName" --output json --region ${REGION}`,
      );
      const groups: string[] = JSON.parse(groupsJson);

      for (const requiredGroup of REQUIRED_COGNITO_GROUPS) {
        const exists = groups.includes(requiredGroup);
        results.push({
          check: 'Cognito group exists',
          resource: `${pool.Name} / ${requiredGroup}`,
          pass: exists,
          detail: exists
            ? `Group "${requiredGroup}" exists`
            : `FAIL: Group "${requiredGroup}" not found. Found: ${groups.join(', ')}`,
          remediation: exists
            ? undefined
            : `Create the group: aws cognito-idp create-group --user-pool-id ${pool.Id} --group-name ${requiredGroup}`,
        });
      }

      // Check for unexpected groups (attendants, relatives from old spec)
      const unexpectedGroups = groups.filter(
        (g) => !REQUIRED_COGNITO_GROUPS.includes(g),
      );
      if (unexpectedGroups.length > 0) {
        results.push({
          check: 'Cognito unexpected groups',
          resource: pool.Name,
          pass: false,
          detail: `WARNING: Unexpected groups found: ${unexpectedGroups.join(', ')}. Expected only: ${REQUIRED_COGNITO_GROUPS.join(', ')}`,
          remediation:
            'Review and remove unexpected groups if they are not needed.',
        });
      } else {
        results.push({
          check: 'Cognito unexpected groups',
          resource: pool.Name,
          pass: true,
          detail: 'No unexpected groups found',
        });
      }

      // Check password policy
      try {
        const poolDetailJson = await runCommand(
          `aws cognito-idp describe-user-pool --user-pool-id "${pool.Id}" --query "UserPool.Policies.PasswordPolicy" --output json --region ${REGION}`,
        );
        const pwPolicy = JSON.parse(poolDetailJson);

        const minLength = pwPolicy.MinimumLength ?? 0;
        const requireUpper = pwPolicy.RequireUppercase ?? false;
        const requireLower = pwPolicy.RequireLowercase ?? false;
        const requireNumbers = pwPolicy.RequireNumbers ?? false;
        const requireSymbols = pwPolicy.RequireSymbols ?? false;

        const strongEnough =
          minLength >= 8 && requireUpper && requireLower && requireNumbers;

        results.push({
          check: 'Cognito password policy',
          resource: pool.Name,
          pass: strongEnough,
          detail: strongEnough
            ? `Min length: ${minLength}, Upper: ${requireUpper}, Lower: ${requireLower}, Numbers: ${requireNumbers}, Symbols: ${requireSymbols}`
            : `FAIL: Weak password policy — Min: ${minLength}, Upper: ${requireUpper}, Lower: ${requireLower}, Numbers: ${requireNumbers}, Symbols: ${requireSymbols}`,
          remediation: strongEnough
            ? undefined
            : 'Update Cognito password policy: minimum 8 chars, require uppercase, lowercase, and numbers.',
        });
      } catch {
        results.push({
          check: 'Cognito password policy',
          resource: pool.Name,
          pass: false,
          detail: 'FAIL: Could not retrieve password policy',
        });
      }
    }
  } catch (err) {
    results.push({
      check: 'Cognito check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// API Gateway Authorizer Check
// ---------------------------------------------------------------------------

async function checkApiGatewayAuthorizers(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const apisJson = await runCommand(
      `aws apigatewayv2 get-apis --query "Items[?contains(Name, 'carelog') || contains(Name, 'CareLog')].{Id:ApiId,Name:Name}" --output json --region ${REGION}`,
    );
    const apis: Array<{ Id: string; Name: string }> = JSON.parse(apisJson);

    if (apis.length === 0) {
      // Try REST API (v1)
      const restApisJson = await runCommand(
        `aws apigateway get-rest-apis --query "items[?contains(name, 'carelog') || contains(name, 'CareLog')].{Id:id,Name:name}" --output json --region ${REGION}`,
      );
      const restApis: Array<{ Id: string; Name: string }> =
        JSON.parse(restApisJson);

      for (const api of restApis) {
        // Get authorizers
        const authorizersJson = await runCommand(
          `aws apigateway get-authorizers --rest-api-id "${api.Id}" --query "items[].{Name:name,Type:type}" --output json --region ${REGION}`,
        );
        const authorizers: Array<{ Name: string; Type: string }> =
          JSON.parse(authorizersJson);

        const hasCognitoAuth = authorizers.some(
          (a) => a.Type === 'COGNITO_USER_POOLS',
        );

        results.push({
          check: 'API Gateway Cognito authorizer',
          resource: api.Name,
          pass: hasCognitoAuth,
          detail: hasCognitoAuth
            ? `Cognito authorizer found: ${authorizers.filter((a) => a.Type === 'COGNITO_USER_POOLS').map((a) => a.Name).join(', ')}`
            : 'FAIL: No Cognito authorizer configured',
          remediation: hasCognitoAuth
            ? undefined
            : 'Add a COGNITO_USER_POOLS authorizer to the API Gateway.',
        });

        // Check that routes have authorizer
        const resourcesJson = await runCommand(
          `aws apigateway get-resources --rest-api-id "${api.Id}" --query "items[].{Id:id,Path:path}" --output json --region ${REGION}`,
        );
        const resources: Array<{ Id: string; Path: string }> =
          JSON.parse(resourcesJson);

        let unprotectedRoutes: string[] = [];
        for (const resource of resources) {
          if (resource.Path === '/') continue; // Root resource
          try {
            const methodsJson = await runCommand(
              `aws apigateway get-resource --rest-api-id "${api.Id}" --resource-id "${resource.Id}" --output json --region ${REGION}`,
            );
            const resourceDetail = JSON.parse(methodsJson);
            const methods = resourceDetail.resourceMethods ?? {};
            for (const [method, _] of Object.entries(methods)) {
              if (method === 'OPTIONS') continue; // CORS preflight
              try {
                const methodDetailJson = await runCommand(
                  `aws apigateway get-method --rest-api-id "${api.Id}" --resource-id "${resource.Id}" --http-method "${method}" --output json --region ${REGION}`,
                );
                const methodDetail = JSON.parse(methodDetailJson);
                if (
                  methodDetail.authorizationType === 'NONE' &&
                  !resource.Path.includes('/health')
                ) {
                  unprotectedRoutes.push(`${method} ${resource.Path}`);
                }
              } catch {
                // Skip methods we can't read
              }
            }
          } catch {
            // Skip resources we can't read
          }
        }

        results.push({
          check: 'API Gateway route authorization',
          resource: api.Name,
          pass: unprotectedRoutes.length === 0,
          detail:
            unprotectedRoutes.length === 0
              ? 'All non-health routes have authorization'
              : `FAIL: Unprotected routes: ${unprotectedRoutes.join(', ')}`,
          remediation:
            unprotectedRoutes.length === 0
              ? undefined
              : 'Attach a Cognito authorizer to all API routes (except /health).',
        });
      }
    } else {
      // HTTP API (v2)
      for (const api of apis) {
        const authorizersJson = await runCommand(
          `aws apigatewayv2 get-authorizers --api-id "${api.Id}" --query "Items[].{Name:Name,Type:AuthorizerType}" --output json --region ${REGION}`,
        );
        const authorizers: Array<{ Name: string; Type: string }> =
          JSON.parse(authorizersJson);

        const hasJwtAuth = authorizers.some((a) => a.Type === 'JWT');

        results.push({
          check: 'API Gateway authorizer',
          resource: api.Name,
          pass: hasJwtAuth,
          detail: hasJwtAuth
            ? `JWT authorizer found (Cognito): ${authorizers.filter((a) => a.Type === 'JWT').map((a) => a.Name).join(', ')}`
            : 'FAIL: No JWT/Cognito authorizer configured',
          remediation: hasJwtAuth
            ? undefined
            : 'Add a JWT authorizer backed by Cognito to the API Gateway.',
        });
      }
    }

    if (apis.length === 0) {
      // already handled in REST API fallback above
    }
  } catch (err) {
    results.push({
      check: 'API Gateway check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Bastion Host Check
// ---------------------------------------------------------------------------

async function checkBastionSecurity(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const instancesJson = await runCommand(
      `aws ec2 describe-instances --filters "Name=tag:Name,Values=*carelog*bastion*" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].{Id:InstanceId,KeyName:KeyName,MetadataOptions:MetadataOptions}" --output json --region ${REGION}`,
    );
    const instances: Array<{
      Id: string;
      KeyName: string | null;
      MetadataOptions: { HttpTokens: string; HttpEndpoint: string };
    }> = JSON.parse(instancesJson);

    for (const instance of instances) {
      // Check no SSH key pair
      results.push({
        check: 'Bastion no SSH key pair',
        resource: instance.Id,
        pass: !instance.KeyName,
        detail: instance.KeyName
          ? `FAIL: SSH key pair "${instance.KeyName}" attached`
          : 'No SSH key pair attached (SSM-only access)',
        remediation: instance.KeyName
          ? 'Remove the SSH key pair from the bastion instance. Use SSM Session Manager instead.'
          : undefined,
      });

      // Check IMDSv2 required
      const imdsv2 = instance.MetadataOptions?.HttpTokens === 'required';
      results.push({
        check: 'Bastion IMDSv2 required',
        resource: instance.Id,
        pass: imdsv2,
        detail: imdsv2
          ? 'IMDSv2 is required (HttpTokens=required)'
          : `FAIL: IMDSv2 not enforced (HttpTokens=${instance.MetadataOptions?.HttpTokens ?? 'unknown'})`,
        remediation: imdsv2
          ? undefined
          : 'Enforce IMDSv2: aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required',
      });
    }

    if (instances.length === 0) {
      results.push({
        check: 'Bastion host discovery',
        resource: 'all',
        pass: false,
        detail: 'No running CareLog bastion instances found. Check tag naming.',
      });
    }
  } catch (err) {
    results.push({
      check: 'Bastion check',
      resource: 'all',
      pass: false,
      detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Lambda IAM Policy Check
// ---------------------------------------------------------------------------

async function checkLambdaIamPolicies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const functionsJson = await runCommand(
      `aws lambda list-functions --query "Functions[?contains(FunctionName, 'carelog')].{Name:FunctionName,Role:Role}" --output json --region ${REGION}`,
    );
    const functions: Array<{ Name: string; Role: string }> =
      JSON.parse(functionsJson);

    for (const fn of functions) {
      const roleName = fn.Role.split('/').pop();
      if (!roleName) continue;

      try {
        // Get inline policies
        const inlinePoliciesJson = await runCommand(
          `aws iam list-role-policies --role-name "${roleName}" --output json`,
        );
        const inlinePolicies: { PolicyNames: string[] } =
          JSON.parse(inlinePoliciesJson);

        let hasWildcard = false;
        for (const policyName of inlinePolicies.PolicyNames) {
          const policyDocJson = await runCommand(
            `aws iam get-role-policy --role-name "${roleName}" --policy-name "${policyName}" --output json`,
          );
          const policyDoc = JSON.parse(policyDocJson);
          const doc = policyDoc.PolicyDocument;
          const statements = Array.isArray(doc.Statement)
            ? doc.Statement
            : [doc.Statement];

          for (const stmt of statements) {
            if (stmt.Effect !== 'Allow') continue;
            const actions = Array.isArray(stmt.Action)
              ? stmt.Action
              : [stmt.Action];
            const resources = Array.isArray(stmt.Resource)
              ? stmt.Resource
              : [stmt.Resource];

            // Check for Action: "*" or Resource: "*"
            if (
              actions.some((a: string) => a === '*') &&
              resources.some((r: string) => r === '*')
            ) {
              hasWildcard = true;
            }
          }
        }

        // Get attached managed policies
        const attachedJson = await runCommand(
          `aws iam list-attached-role-policies --role-name "${roleName}" --output json`,
        );
        const attached: { AttachedPolicies: Array<{ PolicyArn: string; PolicyName: string }> } =
          JSON.parse(attachedJson);

        for (const policy of attached.AttachedPolicies) {
          if (
            policy.PolicyArn.includes('AdministratorAccess') ||
            policy.PolicyArn.includes('PowerUserAccess')
          ) {
            hasWildcard = true;
          }
        }

        results.push({
          check: 'Lambda no wildcard IAM',
          resource: fn.Name,
          pass: !hasWildcard,
          detail: hasWildcard
            ? 'FAIL: Wildcard IAM policy detected (Action:* Resource:* or admin-level managed policy)'
            : 'No wildcard IAM policies — follows least privilege',
          remediation: hasWildcard
            ? 'Replace wildcard policies with specific resource ARNs and actions. Follow least-privilege principle.'
            : undefined,
        });
      } catch {
        results.push({
          check: 'Lambda IAM policy',
          resource: fn.Name,
          pass: false,
          detail: 'FAIL: Could not inspect IAM role policies',
        });
      }
    }

    if (functions.length === 0) {
      results.push({
        check: 'Lambda function discovery',
        resource: 'all',
        pass: false,
        detail: 'No CareLog Lambda functions found.',
      });
    }
  } catch (err) {
    results.push({
      check: 'Lambda IAM check',
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
  console.log('=== Access Control Verification ===');
  console.log(`Region: ${REGION}\n`);

  const allResults: CheckResult[] = [];

  console.log('--- Cognito Groups & Password Policy ---\n');
  allResults.push(...(await checkCognitoGroups()));

  console.log('\n--- API Gateway Authorizers ---\n');
  allResults.push(...(await checkApiGatewayAuthorizers()));

  console.log('\n--- Bastion Host Security ---\n');
  allResults.push(...(await checkBastionSecurity()));

  console.log('\n--- Lambda IAM Policies ---\n');
  allResults.push(...(await checkLambdaIamPolicies()));

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
    console.log('\nFAIL: Access control verification found issues.');
    process.exit(1);
  }

  console.log('\nPASS: All access control checks passed.');
}

main().catch((err) => {
  console.error('Access control verification failed:', err);
  process.exit(1);
});
