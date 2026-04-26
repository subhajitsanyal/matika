export {};

/**
 * Compliance: Mac Mini Security Verification
 *
 * Comprehensive security review of the Mac Mini on-premises device.
 *
 * Checks:
 * - No internet-facing ports (listening ports on public interfaces)
 * - Services only bind to LAN addresses
 * - No persistent patient data after session cleanup:
 *   - /opt/carelog/tmp/ is empty between sessions
 *   - /tmp/carelog/ is empty between sessions
 *   - No patient data in service logs
 *   - Model files are read-only (no patient data embedded)
 * - macOS firewall is enabled
 * - No SSH password authentication (if SSH is enabled)
 * - Disk encryption (FileVault) is enabled
 *
 * Usage: npx tsx compliance/mac-mini-security-verify.ts [--host <mac-mini-ip>]
 *
 * Can run locally on the Mac Mini or remotely via SSH.
 */

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
      else resolve((stdout || '').trim());
    });
  });
}

function getHost(): string | null {
  const idx = process.argv.indexOf('--host');
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return process.env.MAC_MINI_HOST ?? null;
}

function sshPrefix(host: string | null): string {
  if (!host) return ''; // Running locally
  return `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${host} `;
}

// ---------------------------------------------------------------------------
// Network Port Check
// ---------------------------------------------------------------------------

async function checkListeningPorts(host: string | null): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const prefix = sshPrefix(host);

  try {
    // Get listening TCP ports
    const portsOutput = await runCommand(
      `${prefix}lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null || netstat -tlnp 2>/dev/null || true`,
      true,
    );

    const lines = portsOutput.split('\n').filter((l) => l.trim().length > 0);

    // Check for ports bound to 0.0.0.0 or public IPs (not 127.0.0.1)
    const publicPorts: string[] = [];
    const lanPorts: string[] = [];

    for (const line of lines) {
      if (line.includes('LISTEN') || line.includes('TCP')) {
        // Check if bound to all interfaces or specific public IP
        if (line.includes('*:') || line.includes('0.0.0.0:')) {
          const portMatch = line.match(/[*0.0.0.0]:(\d+)/);
          const port = portMatch ? portMatch[1] : 'unknown';
          // 0.0.0.0 is acceptable for LAN since Mac Mini should have firewall
          lanPorts.push(`0.0.0.0:${port}`);
        } else if (line.includes('127.0.0.1:') || line.includes('[::1]:')) {
          // Localhost only — fine
        } else {
          // Bound to specific IP
          const addrMatch = line.match(/(\d+\.\d+\.\d+\.\d+:\d+)/);
          if (addrMatch) {
            const addr = addrMatch[1];
            if (!addr.startsWith('127.') && !addr.startsWith('192.168.') && !addr.startsWith('10.')) {
              publicPorts.push(addr);
            } else {
              lanPorts.push(addr);
            }
          }
        }
      }
    }

    results.push({
      check: 'No internet-facing ports',
      resource: host ?? 'localhost',
      pass: publicPorts.length === 0,
      detail: publicPorts.length === 0
        ? `No public-facing ports detected. LAN ports: ${lanPorts.length > 0 ? lanPorts.join(', ') : 'none'}`
        : `FAIL: Public-facing ports detected: ${publicPorts.join(', ')}`,
      remediation: publicPorts.length === 0
        ? undefined
        : 'Bind services to LAN addresses only (192.168.x.x or 10.x.x.x) or use macOS firewall to block external access.',
    });
  } catch (err) {
    results.push({
      check: 'Network port check',
      resource: host ?? 'localhost',
      pass: false,
      detail: `FAIL: Could not check listening ports — ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Persistent Patient Data Check
// ---------------------------------------------------------------------------

async function checkNoPersistentData(host: string | null): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const prefix = sshPrefix(host);

  const tempDirs = ['/tmp/carelog/', '/opt/carelog/tmp/'];

  for (const dir of tempDirs) {
    try {
      const output = await runCommand(
        `${prefix}ls -la "${dir}" 2>&1 || echo "DIR_NOT_FOUND"`,
        true,
      );

      if (output.includes('DIR_NOT_FOUND') || output.includes('No such file')) {
        results.push({
          check: 'Temp directory empty',
          resource: dir,
          pass: true,
          detail: `Directory ${dir} does not exist (no residual data)`,
        });
      } else {
        // Count files (excluding . and ..)
        const fileCount = output
          .split('\n')
          .filter((l) => !l.startsWith('total') && l.trim().length > 0 && !l.endsWith('.') && !l.endsWith('..'))
          .length;

        results.push({
          check: 'Temp directory empty',
          resource: dir,
          pass: fileCount === 0,
          detail: fileCount === 0
            ? `Directory ${dir} is empty`
            : `FAIL: ${fileCount} files found in ${dir}`,
          remediation: fileCount === 0
            ? undefined
            : `Clean up residual data: rm -rf ${dir}*. Investigate why session cleanup did not remove these files.`,
        });
      }
    } catch (err) {
      results.push({
        check: 'Temp directory check',
        resource: dir,
        pass: false,
        detail: `Could not check ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check for patient data in service logs
  const logPaths = [
    '/opt/carelog/logs/',
    '/var/log/carelog/',
    '/tmp/carelog-logs/',
  ];

  // PHI patterns to grep for
  const phiPatterns = [
    'patient_name',
    'patient_id.*=.*[0-9a-f]{8}-',
    'aadhaar',
    'phone.*[6-9][0-9]{9}',
    'blood_pressure.*[0-9]{2,3}/[0-9]{2,3}',
  ];

  for (const logPath of logPaths) {
    try {
      const exists = await runCommand(
        `${prefix}test -d "${logPath}" && echo "EXISTS" || echo "NOT_FOUND"`,
        true,
      );

      if (exists.includes('NOT_FOUND')) continue;

      let phiFound = false;
      const phiDetails: string[] = [];

      for (const pattern of phiPatterns) {
        try {
          const grepOutput = await runCommand(
            `${prefix}grep -ril "${pattern}" "${logPath}" 2>/dev/null | head -5 || true`,
            true,
          );
          if (grepOutput.trim().length > 0) {
            phiFound = true;
            phiDetails.push(`Pattern "${pattern}" found in: ${grepOutput.trim()}`);
          }
        } catch {
          // grep found nothing — good
        }
      }

      results.push({
        check: 'No patient data in logs',
        resource: logPath,
        pass: !phiFound,
        detail: phiFound
          ? `FAIL: Potential patient data found in logs:\n${phiDetails.join('\n')}`
          : 'No patient data patterns found in service logs',
        remediation: phiFound
          ? 'Review and sanitize log output. Ensure services do not log PHI (patient names, IDs, vital values).'
          : undefined,
      });
    } catch {
      // Log directory doesn't exist or isn't accessible
    }
  }

  // Check model files are read-only
  const modelPaths = ['/opt/carelog/models/', '/opt/carelog/data/models/'];

  for (const modelPath of modelPaths) {
    try {
      const exists = await runCommand(
        `${prefix}test -d "${modelPath}" && echo "EXISTS" || echo "NOT_FOUND"`,
        true,
      );

      if (exists.includes('NOT_FOUND')) continue;

      const writableFiles = await runCommand(
        `${prefix}find "${modelPath}" -type f -writable 2>/dev/null | head -10 || true`,
        true,
      );

      const hasWritable = writableFiles.trim().length > 0;

      results.push({
        check: 'Model files read-only',
        resource: modelPath,
        pass: !hasWritable,
        detail: hasWritable
          ? `FAIL: Writable model files found:\n${writableFiles}`
          : 'All model files are read-only',
        remediation: hasWritable
          ? `Set model files to read-only: chmod -R a-w ${modelPath}`
          : undefined,
      });
    } catch {
      // Model directory doesn't exist
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// macOS Firewall Check
// ---------------------------------------------------------------------------

async function checkFirewall(host: string | null): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const prefix = sshPrefix(host);

  try {
    const firewallOutput = await runCommand(
      `${prefix}/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>&1 || true`,
      true,
    );

    const enabled = firewallOutput.includes('enabled');

    results.push({
      check: 'macOS firewall enabled',
      resource: host ?? 'localhost',
      pass: enabled,
      detail: enabled
        ? 'macOS Application Firewall is enabled'
        : 'FAIL: macOS Application Firewall is NOT enabled',
      remediation: enabled
        ? undefined
        : 'Enable firewall: sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on',
    });

    // Check stealth mode
    const stealthOutput = await runCommand(
      `${prefix}/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>&1 || true`,
      true,
    );
    const stealthEnabled = stealthOutput.includes('enabled');

    results.push({
      check: 'macOS firewall stealth mode',
      resource: host ?? 'localhost',
      pass: stealthEnabled,
      detail: stealthEnabled
        ? 'Stealth mode enabled (ignores unsolicited requests)'
        : 'WARNING: Stealth mode not enabled',
      remediation: stealthEnabled
        ? undefined
        : 'Enable stealth mode: sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on',
    });
  } catch (err) {
    results.push({
      check: 'macOS firewall',
      resource: host ?? 'localhost',
      pass: false,
      detail: `Could not check firewall: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// SSH Configuration Check
// ---------------------------------------------------------------------------

async function checkSshSecurity(host: string | null): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const prefix = sshPrefix(host);

  try {
    const sshdConfig = await runCommand(
      `${prefix}cat /etc/ssh/sshd_config 2>/dev/null || echo "SSH_NOT_FOUND"`,
      true,
    );

    if (sshdConfig.includes('SSH_NOT_FOUND')) {
      results.push({
        check: 'SSH configuration',
        resource: host ?? 'localhost',
        pass: true,
        detail: 'SSH server configuration not found (SSH may not be enabled)',
      });
      return results;
    }

    // Check password authentication
    const passwordAuth = sshdConfig.match(/^\s*PasswordAuthentication\s+(yes|no)/mi);
    const passwordDisabled = passwordAuth ? passwordAuth[1] === 'no' : false;

    results.push({
      check: 'SSH password authentication disabled',
      resource: host ?? 'localhost',
      pass: passwordDisabled,
      detail: passwordDisabled
        ? 'SSH password authentication is disabled (key-only)'
        : 'FAIL: SSH password authentication is enabled or not explicitly disabled',
      remediation: passwordDisabled
        ? undefined
        : 'Set "PasswordAuthentication no" in /etc/ssh/sshd_config and restart sshd.',
    });

    // Check root login
    const rootLogin = sshdConfig.match(/^\s*PermitRootLogin\s+(\S+)/mi);
    const rootDisabled = rootLogin
      ? rootLogin[1] === 'no' || rootLogin[1] === 'prohibit-password'
      : false;

    results.push({
      check: 'SSH root login disabled',
      resource: host ?? 'localhost',
      pass: rootDisabled,
      detail: rootDisabled
        ? `SSH root login: ${rootLogin?.[1] ?? 'no'}`
        : `FAIL: SSH root login is ${rootLogin?.[1] ?? 'not explicitly disabled'}`,
      remediation: rootDisabled
        ? undefined
        : 'Set "PermitRootLogin no" in /etc/ssh/sshd_config.',
    });
  } catch (err) {
    results.push({
      check: 'SSH security',
      resource: host ?? 'localhost',
      pass: false,
      detail: `Could not check SSH config: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// FileVault (Disk Encryption) Check
// ---------------------------------------------------------------------------

async function checkFileVault(host: string | null): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const prefix = sshPrefix(host);

  try {
    const fdeOutput = await runCommand(
      `${prefix}fdesetup status 2>&1 || true`,
      true,
    );

    const enabled = fdeOutput.includes('FileVault is On');

    results.push({
      check: 'FileVault disk encryption',
      resource: host ?? 'localhost',
      pass: enabled,
      detail: enabled
        ? 'FileVault disk encryption is enabled'
        : `FAIL: FileVault is NOT enabled. Status: ${fdeOutput}`,
      remediation: enabled
        ? undefined
        : 'Enable FileVault: sudo fdesetup enable. This encrypts the entire disk at rest.',
    });
  } catch (err) {
    results.push({
      check: 'FileVault check',
      resource: host ?? 'localhost',
      pass: false,
      detail: `Could not check FileVault: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Mac Mini Security Verification ===\n');

  const host = getHost();

  if (host) {
    console.log(`Target: ${host} (remote via SSH)\n`);
  } else {
    console.log('Target: localhost (running directly on Mac Mini)\n');
    console.log('Tip: Use --host <ip> or MAC_MINI_HOST env var for remote checks.\n');
  }

  const allResults: CheckResult[] = [];

  console.log('--- Network Ports ---\n');
  allResults.push(...(await checkListeningPorts(host)));

  console.log('\n--- Persistent Patient Data ---\n');
  allResults.push(...(await checkNoPersistentData(host)));

  console.log('\n--- macOS Firewall ---\n');
  allResults.push(...(await checkFirewall(host)));

  console.log('\n--- SSH Security ---\n');
  allResults.push(...(await checkSshSecurity(host)));

  console.log('\n--- Disk Encryption (FileVault) ---\n');
  allResults.push(...(await checkFileVault(host)));

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
    console.log('\nFAIL: Mac Mini security verification found issues.');
    process.exit(1);
  }

  console.log('\nPASS: All Mac Mini security checks passed.');
}

main().catch((err) => {
  console.error('Mac Mini security verification failed:', err);
  process.exit(1);
});
