export {};

/**
 * Pilot: Readiness Check
 *
 * Runs ALL compliance and security verification scripts in sequence
 * and produces a consolidated PILOT READY / PILOT NOT READY verdict.
 *
 * Checks (in order):
 *  1. Data localisation (all data in ap-south-1)
 *  2. Encryption (S3 KMS, RDS, TLS, SQS)
 *  3. Access controls (Cognito groups, API Gateway, bastion, Lambda IAM)
 *  4. Audit logging (CloudTrail, API GW, RDS, Lambda logs)
 *  5. Data retention (S3 lifecycle, CloudWatch, RDS backups)
 *  6. Mac Mini security (ports, firewall, FileVault, SSH)
 *  7. Certificate/TLS (TLS version, ciphers, HTTPS)
 *  8. Cognito security (MFA, tokens, attributes, groups)
 *  9. PHI log scan (no PHI in CloudWatch/logcat)
 * 10. Mac Mini cleanup (ephemeral data deletion)
 *
 * Usage:
 *   npx tsx pilot/pilot-readiness-check.ts
 *   npx tsx pilot/pilot-readiness-check.ts --skip mac-mini-security --skip mac-mini-cleanup
 *   npx tsx pilot/pilot-readiness-check.ts --api-endpoint https://your-api.execute-api.ap-south-1.amazonaws.com/prod
 */

interface CheckSuite {
  name: string;
  script: string;
  description: string;
  critical: boolean; // If true, failure blocks pilot
}

const CHECK_SUITES: CheckSuite[] = [
  {
    name: 'data-localisation',
    script: '../compliance/data-localisation-verify.ts',
    description: 'All S3/RDS resources in ap-south-1',
    critical: true,
  },
  {
    name: 'encryption',
    script: '../compliance/encryption-verify.ts',
    description: 'Encryption at rest (KMS) and in transit (TLS)',
    critical: true,
  },
  {
    name: 'access-controls',
    script: '../compliance/access-control-verify.ts',
    description: 'Cognito groups, API auth, bastion, Lambda IAM',
    critical: true,
  },
  {
    name: 'audit-logging',
    script: '../compliance/audit-logging-verify.ts',
    description: 'CloudTrail, API GW logging, RDS logging, Lambda logs',
    critical: true,
  },
  {
    name: 'data-retention',
    script: '../compliance/data-retention-verify.ts',
    description: 'S3 lifecycle, CloudWatch retention, RDS backups',
    critical: true,
  },
  {
    name: 'mac-mini-security',
    script: '../compliance/mac-mini-security-verify.ts',
    description: 'Ports, firewall, FileVault, SSH, no persistent data',
    critical: true,
  },
  {
    name: 'cert-tls',
    script: '../compliance/cert-pinning-verify.ts',
    description: 'TLS version, cipher suites, HTTPS connectivity',
    critical: true,
  },
  {
    name: 'cognito-security',
    script: '../compliance/cognito-security-verify.ts',
    description: 'MFA, token expiry, custom attributes, group conflicts',
    critical: true,
  },
  {
    name: 'phi-log-scan',
    script: '../compliance/phi-log-scan.ts',
    description: 'No PHI in CloudWatch or application logs',
    critical: true,
  },
  {
    name: 'mac-mini-cleanup',
    script: '../compliance/mac-mini-cleanup-verify.ts',
    description: 'Ephemeral patient data deletion after sessions',
    critical: true,
  },
];

interface SuiteResult {
  name: string;
  description: string;
  critical: boolean;
  status: 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';
  duration: number; // ms
  error?: string;
}

async function runSuite(suite: CheckSuite, extraArgs: string[]): Promise<SuiteResult> {
  const { exec } = await import('child_process');
  const { resolve } = await import('path');

  const scriptPath = resolve(__dirname, suite.script);
  const args = extraArgs.join(' ');
  const command = `npx tsx "${scriptPath}" ${args}`;

  const startTime = Date.now();

  return new Promise((resolve) => {
    exec(
      command,
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, // 5 min timeout per suite
      (err, stdout, stderr) => {
        const duration = Date.now() - startTime;

        if (err) {
          // Check if it's a controlled failure (exit code 1 from the script)
          const exitCode = err.code;
          if (exitCode === 1) {
            resolve({
              name: suite.name,
              description: suite.description,
              critical: suite.critical,
              status: 'FAIL',
              duration,
            });
          } else {
            resolve({
              name: suite.name,
              description: suite.description,
              critical: suite.critical,
              status: 'ERROR',
              duration,
              error: stderr || err.message,
            });
          }
        } else {
          resolve({
            name: suite.name,
            description: suite.description,
            critical: suite.critical,
            status: 'PASS',
            duration,
          });
        }
      },
    );
  });
}

function parseArgs(): { skipped: Set<string>; extraArgs: string[] } {
  const skipped = new Set<string>();
  const extraArgs: string[] = [];

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip' && args[i + 1]) {
      skipped.add(args[i + 1]);
      i++;
    } else {
      extraArgs.push(args[i]);
    }
  }

  return { skipped, extraArgs };
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('         CARELOG PILOT READINESS CHECK');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  const { skipped, extraArgs } = parseArgs();

  if (skipped.size > 0) {
    console.log(`Skipping: ${Array.from(skipped).join(', ')}\n`);
  }

  const results: SuiteResult[] = [];

  for (let i = 0; i < CHECK_SUITES.length; i++) {
    const suite = CHECK_SUITES[i];
    const num = i + 1;

    if (skipped.has(suite.name)) {
      console.log(`[${num}/${CHECK_SUITES.length}] ${suite.name} ... SKIPPED`);
      results.push({
        name: suite.name,
        description: suite.description,
        critical: suite.critical,
        status: 'SKIP',
        duration: 0,
      });
      continue;
    }

    process.stdout.write(
      `[${num}/${CHECK_SUITES.length}] ${suite.name} ... `,
    );

    const result = await runSuite(suite, extraArgs);
    results.push(result);

    const durationSec = (result.duration / 1000).toFixed(1);
    console.log(`${result.status} (${durationSec}s)`);

    if (result.error) {
      console.log(`  Error: ${result.error.substring(0, 200)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Verdict
  // ---------------------------------------------------------------------------

  console.log('\n' + '='.repeat(60));
  console.log('                    RESULTS');
  console.log('='.repeat(60) + '\n');

  const maxNameLen = Math.max(...results.map((r) => r.name.length));

  for (const r of results) {
    const icon =
      r.status === 'PASS'
        ? '[PASS]'
        : r.status === 'FAIL'
          ? '[FAIL]'
          : r.status === 'SKIP'
            ? '[SKIP]'
            : '[ERR ]';
    const critical = r.critical ? '(critical)' : '(non-critical)';
    console.log(
      `  ${icon} ${r.name.padEnd(maxNameLen)} ${critical} — ${r.description}`,
    );
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const errors = results.filter((r) => r.status === 'ERROR').length;
  const skippedCount = results.filter((r) => r.status === 'SKIP').length;

  console.log(
    `\n  Total: ${results.length} suites | ${passed} passed | ${failed} failed | ${errors} errors | ${skippedCount} skipped`,
  );

  const criticalFailures = results.filter(
    (r) => r.critical && (r.status === 'FAIL' || r.status === 'ERROR'),
  );

  console.log('\n' + '='.repeat(60));

  if (criticalFailures.length > 0) {
    console.log('  VERDICT: PILOT NOT READY');
    console.log('='.repeat(60));
    console.log('\nBlocking failures:');
    for (const f of criticalFailures) {
      console.log(`  - ${f.name}: ${f.status} — ${f.description}`);
    }
    console.log('\nResolve the above issues and re-run this check.');
    process.exit(1);
  } else {
    console.log('  VERDICT: PILOT READY');
    console.log('='.repeat(60));

    if (skippedCount > 0) {
      console.log(
        `\nNote: ${skippedCount} check(s) were skipped. Ensure they pass before full deployment.`,
      );
    }

    console.log('\nAll critical compliance and security checks passed.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Pilot readiness check failed:', err);
  process.exit(1);
});
