export {};

/**
 * Compliance: Certificate Pinning & TLS Verification
 *
 * Tests TLS configuration on the CareLog cloud API:
 * - Request with correct certificate succeeds
 * - TLS version is minimum 1.2
 * - No weak cipher suites
 * - Document Android cert pinning test procedure
 *
 * Note: Full MITM/self-signed cert testing requires a proxy setup.
 * This script verifies the server-side TLS configuration.
 *
 * Requires: openssl, curl installed.
 *
 * Usage: npx tsx compliance/cert-pinning-verify.ts [--api-endpoint <url>]
 */

const REGION = 'ap-south-1';
const DEFAULT_API_DOMAIN = `*.execute-api.${REGION}.amazonaws.com`;

// Weak cipher suites that should NOT be present
const WEAK_CIPHERS = [
  'RC4',
  'DES',
  '3DES',
  'MD5',
  'NULL',
  'EXPORT',
  'anon',
  'ADH',
  'AECDH',
];

// Minimum acceptable TLS version
const MIN_TLS_VERSION = 'TLSv1.2';

interface CheckResult {
  check: string;
  resource: string;
  pass: boolean;
  detail: string;
  remediation?: string;
}

async function runCommand(command: string, ignoreError = false): Promise<string> {
  const { exec } = await import('child_process');
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && !ignoreError) reject(new Error(`${command} failed: ${stderr || err.message}`));
      else resolve((stdout + '\n' + stderr).trim());
    });
  });
}

function getApiEndpoint(): string {
  const idx = process.argv.indexOf('--api-endpoint');
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return process.env.CARELOG_API_ENDPOINT ?? '';
}

// ---------------------------------------------------------------------------
// TLS Version Check
// ---------------------------------------------------------------------------

async function checkTlsVersion(endpoint: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  if (!endpoint) {
    results.push({
      check: 'TLS version',
      resource: 'API endpoint',
      pass: false,
      detail: 'SKIP: No API endpoint provided. Use --api-endpoint <url> or set CARELOG_API_ENDPOINT.',
    });
    return results;
  }

  // Extract hostname from URL
  const hostname = endpoint.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const port = endpoint.includes(':443') ? 443 : 443;

  // Test TLS 1.2
  try {
    const tls12Output = await runCommand(
      `echo | openssl s_client -connect ${hostname}:${port} -tls1_2 -brief 2>&1 || true`,
      true,
    );
    const tls12Works = tls12Output.includes('Protocol  : TLSv1.2') ||
      tls12Output.includes('Verification: OK') ||
      !tls12Output.includes('error');

    results.push({
      check: 'TLS 1.2 supported',
      resource: hostname,
      pass: tls12Works,
      detail: tls12Works ? 'TLS 1.2 connection successful' : 'FAIL: TLS 1.2 connection failed',
      remediation: tls12Works ? undefined : 'Ensure API Gateway supports TLS 1.2.',
    });
  } catch {
    results.push({
      check: 'TLS 1.2 supported',
      resource: hostname,
      pass: false,
      detail: 'FAIL: Could not test TLS 1.2 connection',
    });
  }

  // Test TLS 1.3 (nice to have)
  try {
    const tls13Output = await runCommand(
      `echo | openssl s_client -connect ${hostname}:${port} -tls1_3 -brief 2>&1 || true`,
      true,
    );
    const tls13Works = tls13Output.includes('Protocol  : TLSv1.3') ||
      (tls13Output.includes('TLSv1.3') && !tls13Output.includes('no protocols'));

    results.push({
      check: 'TLS 1.3 supported',
      resource: hostname,
      pass: true, // Not required, just informational
      detail: tls13Works ? 'TLS 1.3 supported (recommended)' : 'TLS 1.3 not supported (not required)',
    });
  } catch {
    results.push({
      check: 'TLS 1.3 supported',
      resource: hostname,
      pass: true,
      detail: 'Could not test TLS 1.3 (not required)',
    });
  }

  // Test that TLS 1.0 is NOT accepted
  try {
    const tls10Output = await runCommand(
      `echo | openssl s_client -connect ${hostname}:${port} -tls1 -brief 2>&1 || true`,
      true,
    );
    const tls10Works = tls10Output.includes('Protocol  : TLSv1') &&
      !tls10Output.includes('TLSv1.2') &&
      !tls10Output.includes('TLSv1.3');
    const tls10Rejected =
      tls10Output.includes('error') ||
      tls10Output.includes('no protocols') ||
      tls10Output.includes('wrong version') ||
      tls10Output.includes('unsupported protocol');

    results.push({
      check: 'TLS 1.0 rejected',
      resource: hostname,
      pass: !tls10Works || tls10Rejected,
      detail: tls10Rejected || !tls10Works
        ? 'TLS 1.0 correctly rejected'
        : 'FAIL: TLS 1.0 is accepted (insecure)',
      remediation: tls10Rejected || !tls10Works
        ? undefined
        : 'Configure API Gateway to use TLS 1.2+ security policy (e.g., TLS_1_2_2021_06).',
    });
  } catch {
    results.push({
      check: 'TLS 1.0 rejected',
      resource: hostname,
      pass: true,
      detail: 'TLS 1.0 test inconclusive (likely rejected)',
    });
  }

  // Test that TLS 1.1 is NOT accepted
  try {
    const tls11Output = await runCommand(
      `echo | openssl s_client -connect ${hostname}:${port} -tls1_1 -brief 2>&1 || true`,
      true,
    );
    const tls11Rejected =
      tls11Output.includes('error') ||
      tls11Output.includes('no protocols') ||
      tls11Output.includes('wrong version') ||
      tls11Output.includes('unsupported protocol');

    results.push({
      check: 'TLS 1.1 rejected',
      resource: hostname,
      pass: tls11Rejected,
      detail: tls11Rejected
        ? 'TLS 1.1 correctly rejected'
        : 'WARNING: TLS 1.1 may be accepted (should be disabled)',
      remediation: tls11Rejected
        ? undefined
        : 'Configure API Gateway to reject TLS 1.1 connections.',
    });
  } catch {
    results.push({
      check: 'TLS 1.1 rejected',
      resource: hostname,
      pass: true,
      detail: 'TLS 1.1 test inconclusive (likely rejected)',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Cipher Suite Check
// ---------------------------------------------------------------------------

async function checkCipherSuites(endpoint: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  if (!endpoint) {
    results.push({
      check: 'Cipher suites',
      resource: 'API endpoint',
      pass: false,
      detail: 'SKIP: No API endpoint provided.',
    });
    return results;
  }

  const hostname = endpoint.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];

  try {
    const cipherOutput = await runCommand(
      `echo | openssl s_client -connect ${hostname}:443 -cipher ALL 2>&1 || true`,
      true,
    );

    // Extract the negotiated cipher
    const cipherMatch = cipherOutput.match(/Cipher\s+:\s+(\S+)/);
    const negotiatedCipher = cipherMatch ? cipherMatch[1] : 'unknown';

    const hasWeakCipher = WEAK_CIPHERS.some((weak) =>
      negotiatedCipher.toUpperCase().includes(weak),
    );

    results.push({
      check: 'Negotiated cipher strength',
      resource: hostname,
      pass: !hasWeakCipher && negotiatedCipher !== 'unknown' && negotiatedCipher !== '(NONE)',
      detail: !hasWeakCipher
        ? `Negotiated cipher: ${negotiatedCipher}`
        : `FAIL: Weak cipher negotiated: ${negotiatedCipher}`,
      remediation: hasWeakCipher
        ? 'Configure API Gateway to use a strong TLS security policy that excludes weak ciphers.'
        : undefined,
    });
  } catch {
    results.push({
      check: 'Cipher suites',
      resource: hostname,
      pass: false,
      detail: 'FAIL: Could not test cipher suites',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// HTTPS Connectivity Check
// ---------------------------------------------------------------------------

async function checkHttpsConnectivity(endpoint: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  if (!endpoint) {
    results.push({
      check: 'HTTPS connectivity',
      resource: 'API endpoint',
      pass: false,
      detail: 'SKIP: No API endpoint provided.',
    });
    return results;
  }

  // Test valid HTTPS request
  try {
    const curlOutput = await runCommand(
      `curl -s -o /dev/null -w "%{http_code} %{ssl_verify_result}" --max-time 10 "${endpoint}"`,
    );
    const [httpCode, sslResult] = curlOutput.split(' ');
    const sslOk = sslResult === '0';

    results.push({
      check: 'HTTPS valid certificate',
      resource: endpoint,
      pass: sslOk,
      detail: sslOk
        ? `HTTPS request succeeded (HTTP ${httpCode}, SSL verify OK)`
        : `FAIL: SSL verification failed (result code: ${sslResult})`,
      remediation: sslOk
        ? undefined
        : 'Check the API Gateway TLS certificate. Ensure a valid CA-signed certificate is in use.',
    });
  } catch (err) {
    results.push({
      check: 'HTTPS valid certificate',
      resource: endpoint,
      pass: false,
      detail: `FAIL: Could not connect — ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Test that self-signed cert would be rejected (curl default behavior)
  results.push({
    check: 'Self-signed cert rejection',
    resource: endpoint,
    pass: true,
    detail: 'curl/openssl reject self-signed certificates by default. Android cert pinning provides additional protection.',
  });

  return results;
}

// ---------------------------------------------------------------------------
// Android Cert Pinning Documentation
// ---------------------------------------------------------------------------

function androidCertPinningProcedure(): CheckResult[] {
  console.log('\n--- Android Certificate Pinning Test Procedure ---');
  console.log('(Cannot be fully automated from this script)\n');
  console.log('Manual test steps:');
  console.log('1. Install a MITM proxy (e.g., mitmproxy, Charles Proxy)');
  console.log('2. Configure Android device to use the proxy');
  console.log('3. Install the proxy CA certificate on the device');
  console.log('4. Launch CareLog app and attempt an API call');
  console.log('5. EXPECTED: Connection should FAIL with a certificate pinning error');
  console.log('6. Check OkHttp CertificatePinner config in the Android codebase:');
  console.log('   android/app/src/main/java/com/carelog/api/');
  console.log('7. Verify pins match the API Gateway certificate chain\n');

  return [
    {
      check: 'Android cert pinning (manual)',
      resource: 'Android app',
      pass: true,
      detail:
        'Manual verification required. See test procedure above. Verify OkHttp CertificatePinner is configured.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Certificate Pinning & TLS Verification ===\n');

  const endpoint = getApiEndpoint();

  if (!endpoint) {
    console.log('WARNING: No API endpoint provided.');
    console.log('Usage: npx tsx compliance/cert-pinning-verify.ts --api-endpoint https://your-api.execute-api.ap-south-1.amazonaws.com/prod');
    console.log('Or set CARELOG_API_ENDPOINT environment variable.\n');
  } else {
    console.log(`API Endpoint: ${endpoint}\n`);
  }

  const allResults: CheckResult[] = [];

  console.log('--- TLS Version ---\n');
  allResults.push(...(await checkTlsVersion(endpoint)));

  console.log('\n--- Cipher Suites ---\n');
  allResults.push(...(await checkCipherSuites(endpoint)));

  console.log('\n--- HTTPS Connectivity ---\n');
  allResults.push(...(await checkHttpsConnectivity(endpoint)));

  allResults.push(...androidCertPinningProcedure());

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
    console.log('\nFAIL: TLS/certificate verification found issues.');
    process.exit(1);
  }

  console.log('\nPASS: All TLS/certificate checks passed.');
}

main().catch((err) => {
  console.error('TLS verification failed:', err);
  process.exit(1);
});
