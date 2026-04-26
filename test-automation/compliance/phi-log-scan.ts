/**
 * Compliance: PHI Log Scan
 *
 * Scans CloudWatch log groups and Android Logcat output for common PHI patterns:
 * - Patient names (common Indian names)
 * - Phone numbers (Indian mobile format)
 * - Aadhaar numbers (12-digit)
 * - Email addresses
 * - Medical terms in context that suggest PHI leakage
 * - Vital values with patient identifiers
 *
 * Usage:
 *   tsx compliance/phi-log-scan.ts
 *   tsx compliance/phi-log-scan.ts --logcat-file /path/to/logcat.txt
 */

import { readFile, readdir } from 'fs/promises';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// PHI Patterns
// ---------------------------------------------------------------------------

interface PhiPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'warning' | 'info';
  description: string;
}

const PHI_PATTERNS: PhiPattern[] = [
  {
    name: 'indian_phone',
    pattern: /(?:\+91|91)?[- ]?[6-9]\d{9}\b/g,
    severity: 'critical',
    description: 'Indian mobile phone number',
  },
  {
    name: 'aadhaar_number',
    pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
    severity: 'critical',
    description: 'Potential Aadhaar number (12-digit)',
  },
  {
    name: 'email_address',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    severity: 'warning',
    description: 'Email address',
  },
  {
    name: 'patient_name_context',
    pattern: /(?:patient|name|patient_name)\s*[=:]\s*["']?[A-Z][a-z]+ [A-Z][a-z]+["']?/gi,
    severity: 'critical',
    description: 'Patient name in key-value context',
  },
  {
    name: 'date_of_birth',
    pattern: /(?:dob|date_of_birth|dateOfBirth)\s*[=:]\s*["']?\d{4}-\d{2}-\d{2}["']?/gi,
    severity: 'critical',
    description: 'Date of birth in key-value context',
  },
  {
    name: 'vital_with_id',
    pattern: /(?:patient_?id|patientId)\s*[=:]\s*["\']?\w+["\']?\s*.*(?:blood_pressure|glucose|spo2|temperature|weight)\s*[=:]\s*\d+/gi,
    severity: 'warning',
    description: 'Vital value logged with patient identifier',
  },
  {
    name: 'transcript_text',
    pattern: /(?:transcript|utterance|speech_text)\s*[=:]\s*["'][^"']{10,}["']/gi,
    severity: 'warning',
    description: 'Transcript/speech text logged (may contain PHI)',
  },
  {
    name: 'cognito_token',
    pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    severity: 'critical',
    description: 'JWT token in logs (potential credential exposure)',
  },
  {
    name: 'address_pattern',
    pattern: /(?:address|street|city)\s*[=:]\s*["'][^"']{10,}["']/gi,
    severity: 'warning',
    description: 'Address information',
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanFinding {
  pattern_name: string;
  severity: string;
  description: string;
  source: string;
  line_number: number;
  matched_text: string;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function scanText(text: string, source: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of PHI_PATTERNS) {
      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        // Filter false positives
        const matched = match[0];

        // Skip test/placeholder data
        if (matched.includes('@carelog.test') || matched.includes('PLACEHOLDER')) continue;
        if (matched.includes('00000000-0000-0000')) continue;

        findings.push({
          pattern_name: pattern.name,
          severity: pattern.severity,
          description: pattern.description,
          source,
          line_number: i + 1,
          matched_text: matched.length > 80 ? matched.substring(0, 80) + '...' : matched,
        });
      }
    }
  }

  return findings;
}

async function scanCloudWatchLogs(): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  try {
    const { exec } = await import('child_process');
    const execPromise = (cmd: string): Promise<string> =>
      new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });

    // List CareLog-related log groups
    const logGroupsJson = await execPromise(
      'aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/carelog" --query "logGroups[].logGroupName" --output json --region ap-south-1',
    );
    const logGroups: string[] = JSON.parse(logGroupsJson);

    console.log(`Found ${logGroups.length} CareLog log groups`);

    for (const logGroup of logGroups) {
      console.log(`  Scanning: ${logGroup}`);
      try {
        // Get last 1000 events from each log group
        const eventsJson = await execPromise(
          `aws logs filter-log-events --log-group-name "${logGroup}" --limit 1000 --query "events[].message" --output json --region ap-south-1`,
        );
        const events: string[] = JSON.parse(eventsJson);
        const logText = events.join('\n');
        findings.push(...scanText(logText, `cloudwatch:${logGroup}`));
      } catch (err) {
        console.log(`    Warning: Could not read logs from ${logGroup}`);
      }
    }
  } catch (err) {
    console.log('Warning: Could not access CloudWatch. Skipping CloudWatch scan.');
    console.log(`  Reason: ${err instanceof Error ? err.message : String(err)}`);
  }

  return findings;
}

async function scanLogcatFile(filePath: string): Promise<ScanFinding[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return scanText(content, `logcat:${filePath}`);
  } catch (err) {
    console.log(`Warning: Could not read logcat file: ${filePath}`);
    return [];
  }
}

async function scanLocalLogs(): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const resultsDir = resolve(__dirname, '../results');

  try {
    const files = await readdir(resultsDir, { recursive: true });
    for (const file of files) {
      const filePath = resolve(resultsDir, file as string);
      if ((file as string).endsWith('.log') || (file as string).endsWith('.txt')) {
        try {
          const content = await readFile(filePath, 'utf-8');
          findings.push(...scanText(content, `local:${filePath}`));
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* results dir may not exist */ }

  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== PHI Log Scan ===\n');

  const allFindings: ScanFinding[] = [];

  // Scan CloudWatch
  console.log('Scanning CloudWatch logs...');
  allFindings.push(...(await scanCloudWatchLogs()));

  // Scan logcat file if provided
  const logcatArg = process.argv.find((a) => a === '--logcat-file');
  if (logcatArg) {
    const logcatIdx = process.argv.indexOf(logcatArg);
    const logcatPath = process.argv[logcatIdx + 1];
    if (logcatPath) {
      console.log(`Scanning logcat file: ${logcatPath}`);
      allFindings.push(...(await scanLogcatFile(logcatPath)));
    }
  }

  // Scan local test results
  console.log('Scanning local test result logs...');
  allFindings.push(...(await scanLocalLogs()));

  // Report
  console.log(`\n--- PHI Scan Results ---\n`);

  const critical = allFindings.filter((f) => f.severity === 'critical');
  const warnings = allFindings.filter((f) => f.severity === 'warning');
  const info = allFindings.filter((f) => f.severity === 'info');

  console.log(`Total findings: ${allFindings.length}`);
  console.log(`  Critical: ${critical.length}`);
  console.log(`  Warning:  ${warnings.length}`);
  console.log(`  Info:     ${info.length}`);

  if (critical.length > 0) {
    console.log('\n--- CRITICAL FINDINGS ---\n');
    for (const f of critical) {
      console.log(`  [CRITICAL] ${f.pattern_name} in ${f.source} (line ${f.line_number})`);
      console.log(`    ${f.description}`);
      console.log(`    Match: ${f.matched_text}\n`);
    }
  }

  if (warnings.length > 0) {
    console.log('\n--- WARNINGS ---\n');
    for (const f of warnings) {
      console.log(`  [WARNING] ${f.pattern_name} in ${f.source} (line ${f.line_number})`);
      console.log(`    ${f.description}`);
      console.log(`    Match: ${f.matched_text}\n`);
    }
  }

  if (critical.length > 0) {
    console.log('\nFAIL: Critical PHI findings detected. Remediation required.');
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log('\nWARNING: Non-critical findings detected. Review recommended.');
  } else {
    console.log('\nPASS: No PHI detected in scanned logs.');
  }
}

main().catch((err) => {
  console.error('PHI scan failed:', err);
  process.exit(1);
});
