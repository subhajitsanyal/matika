export {};

/**
 * Compliance: Cognito Security Verification
 *
 * Verifies Cognito-specific security configuration for CareLog.
 *
 * Checks:
 * - MFA is available (even if not required for pilot)
 * - Token expiration times are reasonable (access <= 1hr, refresh <= 30d)
 * - Custom attributes are properly scoped (custom:persona_type, custom:linked_patient_id)
 * - No users in multiple conflicting groups
 * - Password reset flow configuration
 *
 * Requires: AWS credentials with Cognito read access.
 *
 * Usage: npx tsx compliance/cognito-security-verify.ts
 */

const REGION = 'ap-south-1';

const REQUIRED_CUSTOM_ATTRIBUTES = [
  'custom:persona_type',
  'custom:linked_patient_id',
];

const COGNITO_GROUPS = ['patients', 'caregivers', 'doctors'];

// Conflicting group combinations (a user should not be in both)
const CONFLICTING_GROUPS: [string, string][] = [
  ['patients', 'doctors'],
  ['patients', 'caregivers'],
];

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

async function findUserPool(): Promise<{ Id: string; Name: string } | null> {
  try {
    const poolsJson = await runCommand(
      `aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?contains(Name, 'carelog') || contains(Name, 'CareLog')].{Id:Id,Name:Name}" --output json --region ${REGION}`,
    );
    const pools: Array<{ Id: string; Name: string }> = JSON.parse(poolsJson);
    return pools[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// MFA Check
// ---------------------------------------------------------------------------

async function checkMfa(poolId: string, poolName: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const poolJson = await runCommand(
      `aws cognito-idp describe-user-pool --user-pool-id "${poolId}" --query "UserPool.MfaConfiguration" --output text --region ${REGION}`,
    );

    const mfaConfig = poolJson.trim();
    // OPTIONAL means available but not required; ON means required; OFF means disabled
    const mfaAvailable = mfaConfig === 'OPTIONAL' || mfaConfig === 'ON';

    results.push({
      check: 'Cognito MFA available',
      resource: poolName,
      pass: mfaAvailable,
      detail: mfaAvailable
        ? `MFA configuration: ${mfaConfig}`
        : `FAIL: MFA is ${mfaConfig} (should be at least OPTIONAL for pilot)`,
      remediation: mfaAvailable
        ? undefined
        : 'Enable MFA: aws cognito-idp set-user-pool-mfa-config --user-pool-id <pool-id> --mfa-configuration OPTIONAL --software-token-mfa-configuration Enabled=true',
    });
  } catch (err) {
    results.push({
      check: 'Cognito MFA',
      resource: poolName,
      pass: false,
      detail: `FAIL: Could not check MFA: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Token Expiration Check
// ---------------------------------------------------------------------------

async function checkTokenExpiration(poolId: string, poolName: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    // Get app clients
    const clientsJson = await runCommand(
      `aws cognito-idp list-user-pool-clients --user-pool-id "${poolId}" --query "UserPoolClients[].{Id:ClientId,Name:ClientName}" --output json --region ${REGION}`,
    );
    const clients: Array<{ Id: string; Name: string }> = JSON.parse(clientsJson);

    for (const client of clients) {
      try {
        const clientDetailJson = await runCommand(
          `aws cognito-idp describe-user-pool-client --user-pool-id "${poolId}" --client-id "${client.Id}" --query "UserPoolClient.{AccessTokenValidity:AccessTokenValidity,IdTokenValidity:IdTokenValidity,RefreshTokenValidity:RefreshTokenValidity,TokenValidityUnits:TokenValidityUnits}" --output json --region ${REGION}`,
        );
        const detail = JSON.parse(clientDetailJson);

        const units = detail.TokenValidityUnits ?? {};
        const accessUnit = units.AccessToken ?? 'hours';
        const refreshUnit = units.RefreshToken ?? 'days';

        const accessValidity = detail.AccessTokenValidity ?? 1; // default 1 hour
        const refreshValidity = detail.RefreshTokenValidity ?? 30; // default 30 days

        // Convert to hours for access token check
        let accessHours = accessValidity;
        if (accessUnit === 'minutes') accessHours = accessValidity / 60;
        else if (accessUnit === 'days') accessHours = accessValidity * 24;

        // Convert to days for refresh token check
        let refreshDays = refreshValidity;
        if (refreshUnit === 'hours') refreshDays = refreshValidity / 24;
        else if (refreshUnit === 'minutes') refreshDays = refreshValidity / (24 * 60);

        results.push({
          check: 'Access token expiration <= 1 hour',
          resource: `${poolName} / ${client.Name}`,
          pass: accessHours <= 1,
          detail: accessHours <= 1
            ? `Access token: ${accessValidity} ${accessUnit}`
            : `FAIL: Access token validity is ${accessValidity} ${accessUnit} (${accessHours}h, max 1h)`,
          remediation: accessHours <= 1
            ? undefined
            : 'Set access token validity to 1 hour or less in the Cognito app client settings.',
        });

        results.push({
          check: 'Refresh token expiration <= 30 days',
          resource: `${poolName} / ${client.Name}`,
          pass: refreshDays <= 30,
          detail: refreshDays <= 30
            ? `Refresh token: ${refreshValidity} ${refreshUnit}`
            : `FAIL: Refresh token validity is ${refreshValidity} ${refreshUnit} (${refreshDays}d, max 30d)`,
          remediation: refreshDays <= 30
            ? undefined
            : 'Set refresh token validity to 30 days or less.',
        });
      } catch {
        results.push({
          check: 'Token expiration',
          resource: `${poolName} / ${client.Name}`,
          pass: false,
          detail: 'FAIL: Could not retrieve client token settings',
        });
      }
    }

    if (clients.length === 0) {
      results.push({
        check: 'Token expiration',
        resource: poolName,
        pass: false,
        detail: 'No app clients found in the user pool.',
      });
    }
  } catch (err) {
    results.push({
      check: 'Token expiration',
      resource: poolName,
      pass: false,
      detail: `FAIL: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Custom Attributes Check
// ---------------------------------------------------------------------------

async function checkCustomAttributes(poolId: string, poolName: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const poolDetailJson = await runCommand(
      `aws cognito-idp describe-user-pool --user-pool-id "${poolId}" --query "UserPool.SchemaAttributes[?starts_with(Name, 'custom:')].{Name:Name,Mutable:Mutable,Required:Required,Type:AttributeDataType}" --output json --region ${REGION}`,
    );
    const customAttrs: Array<{
      Name: string;
      Mutable: boolean;
      Required: boolean;
      Type: string;
    }> = JSON.parse(poolDetailJson);

    const attrNames = customAttrs.map((a) => a.Name);

    for (const required of REQUIRED_CUSTOM_ATTRIBUTES) {
      const exists = attrNames.includes(required);
      results.push({
        check: 'Custom attribute exists',
        resource: `${poolName} / ${required}`,
        pass: exists,
        detail: exists
          ? `Attribute "${required}" exists (type: ${customAttrs.find((a) => a.Name === required)?.Type})`
          : `FAIL: Required attribute "${required}" not found. Found: ${attrNames.join(', ') || 'none'}`,
        remediation: exists
          ? undefined
          : `Custom attributes must be defined at user pool creation. Recreate the pool with the "${required}" attribute.`,
      });
    }

    // Check for custom:onboarded_by (mentioned in spec)
    const hasOnboardedBy = attrNames.includes('custom:onboarded_by');
    results.push({
      check: 'Custom attribute: custom:onboarded_by',
      resource: poolName,
      pass: true, // Not strictly required, just informational
      detail: hasOnboardedBy
        ? 'custom:onboarded_by attribute exists'
        : 'custom:onboarded_by not found (optional per current config)',
    });
  } catch (err) {
    results.push({
      check: 'Custom attributes',
      resource: poolName,
      pass: false,
      detail: `FAIL: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Conflicting Group Membership Check
// ---------------------------------------------------------------------------

async function checkConflictingGroups(poolId: string, poolName: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const conflicts: string[] = [];

    for (const [groupA, groupB] of CONFLICTING_GROUPS) {
      // Get users in group A
      let usersA: string[] = [];
      try {
        const usersAJson = await runCommand(
          `aws cognito-idp list-users-in-group --user-pool-id "${poolId}" --group-name "${groupA}" --query "Users[].Username" --output json --region ${REGION}`,
        );
        usersA = JSON.parse(usersAJson);
      } catch {
        continue; // Group may not exist
      }

      // Get users in group B
      let usersB: string[] = [];
      try {
        const usersBJson = await runCommand(
          `aws cognito-idp list-users-in-group --user-pool-id "${poolId}" --group-name "${groupB}" --query "Users[].Username" --output json --region ${REGION}`,
        );
        usersB = JSON.parse(usersBJson);
      } catch {
        continue;
      }

      // Find overlap
      const overlap = usersA.filter((u) => usersB.includes(u));
      if (overlap.length > 0) {
        conflicts.push(
          `Users in both "${groupA}" and "${groupB}": ${overlap.join(', ')}`,
        );
      }
    }

    results.push({
      check: 'No conflicting group memberships',
      resource: poolName,
      pass: conflicts.length === 0,
      detail: conflicts.length === 0
        ? 'No users found in conflicting groups'
        : `FAIL: Conflicting memberships:\n${conflicts.join('\n')}`,
      remediation: conflicts.length === 0
        ? undefined
        : 'Remove users from conflicting groups. A user should only belong to one persona group.',
    });
  } catch (err) {
    results.push({
      check: 'Conflicting groups',
      resource: poolName,
      pass: false,
      detail: `FAIL: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Password Reset Flow Check
// ---------------------------------------------------------------------------

async function checkPasswordReset(poolId: string, poolName: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const poolDetailJson = await runCommand(
      `aws cognito-idp describe-user-pool --user-pool-id "${poolId}" --query "UserPool.{AccountRecovery:AccountRecoverySetting,AutoVerified:AutoVerifiedAttributes}" --output json --region ${REGION}`,
    );
    const detail = JSON.parse(poolDetailJson);

    const recoveryMechanisms =
      detail.AccountRecovery?.RecoveryMechanisms ?? [];
    const hasRecovery = recoveryMechanisms.length > 0;

    results.push({
      check: 'Password recovery configured',
      resource: poolName,
      pass: hasRecovery,
      detail: hasRecovery
        ? `Recovery mechanisms: ${recoveryMechanisms.map((r: any) => `${r.Name} (priority ${r.Priority})`).join(', ')}`
        : 'FAIL: No account recovery mechanisms configured',
      remediation: hasRecovery
        ? undefined
        : 'Configure account recovery in Cognito (e.g., verified email or phone number).',
    });

    const autoVerified = detail.AutoVerified ?? [];
    results.push({
      check: 'Auto-verified attributes',
      resource: poolName,
      pass: autoVerified.length > 0,
      detail: autoVerified.length > 0
        ? `Auto-verified: ${autoVerified.join(', ')}`
        : 'WARNING: No auto-verified attributes (password reset may not work)',
      remediation: autoVerified.length > 0
        ? undefined
        : 'Set auto-verified attributes (email or phone_number) in the Cognito user pool.',
    });
  } catch (err) {
    results.push({
      check: 'Password reset',
      resource: poolName,
      pass: false,
      detail: `FAIL: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Cognito Security Verification ===');
  console.log(`Region: ${REGION}\n`);

  const pool = await findUserPool();

  if (!pool) {
    console.log('FAIL: No CareLog Cognito user pool found.');
    process.exit(1);
  }

  console.log(`User Pool: ${pool.Name} (${pool.Id})\n`);

  const allResults: CheckResult[] = [];

  console.log('--- MFA Configuration ---\n');
  allResults.push(...(await checkMfa(pool.Id, pool.Name)));

  console.log('\n--- Token Expiration ---\n');
  allResults.push(...(await checkTokenExpiration(pool.Id, pool.Name)));

  console.log('\n--- Custom Attributes ---\n');
  allResults.push(...(await checkCustomAttributes(pool.Id, pool.Name)));

  console.log('\n--- Conflicting Group Memberships ---\n');
  allResults.push(...(await checkConflictingGroups(pool.Id, pool.Name)));

  console.log('\n--- Password Reset Flow ---\n');
  allResults.push(...(await checkPasswordReset(pool.Id, pool.Name)));

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
    console.log('\nFAIL: Cognito security verification found issues.');
    process.exit(1);
  }

  console.log('\nPASS: All Cognito security checks passed.');
}

main().catch((err) => {
  console.error('Cognito security verification failed:', err);
  process.exit(1);
});
