# HIPAA Compliance Checklist

Health Insurance Portability and Accountability Act — CareLog Verification

## Administrative Safeguards (45 CFR 164.308)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Risk analysis conducted | pending | Security assessment document |
| 2 | Risk management plan in place | pending | Risk register |
| 3 | Workforce training on PHI handling | pending | Training records |
| 4 | Access management procedures documented | pending | Access control policy |
| 5 | Incident response procedures in place | pending | Incident response plan |

## Physical Safeguards (45 CFR 164.310)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 6 | Mac Mini physically secured | pending | Physical security audit |
| 7 | Mac Mini accessible only on LAN (no internet exposure) | pending | Network configuration review |
| 8 | Device disposal procedures documented | pending | Device lifecycle policy |

## Technical Safeguards (45 CFR 164.312)

### Access Control

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 9 | Unique user identification (Cognito sub) | pending | Cognito user pool config |
| 10 | Emergency access procedure | pending | Break-glass documentation |
| 11 | Automatic logoff (session timeout) | pending | Cognito token expiry; app session timeout |
| 12 | Encryption at rest (S3 KMS, RDS encryption) | pending | Terraform config |
| 13 | Role-based access (patient, caregiver, doctor groups) | pending | Cognito groups + API authorizer |

### Audit Controls

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 14 | CloudTrail logging enabled | pending | Terraform CloudTrail resource |
| 15 | API Gateway access logging | pending | API Gateway stage config |
| 16 | Application-level audit log | pending | `audit-log` Lambda + RDS table |
| 17 | Audit logs retained for 6+ years | pending | CloudWatch log retention policy |
| 18 | Audit log integrity verification | pending | CloudTrail log file validation |

### Integrity

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 19 | PHI integrity mechanisms (checksums) | pending | S3 object checksums |
| 20 | FHIR Observation schema validation | pending | Lambda input validation |
| 21 | Database constraints enforce data integrity | pending | RDS schema CHECK constraints |

### Transmission Security

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 22 | TLS 1.2+ for all cloud API calls | pending | API Gateway TLS config |
| 23 | Certificate pinning on Android | pending | OkHttp CertificatePinner config |
| 24 | No PHI transmitted to Mac Mini over internet | pending | LAN-only architecture |
| 25 | Mac Mini plain HTTP acceptable (LAN only) | pending | Architecture documentation |
| 26 | RDS connections use SSL | pending | RDS parameter group |

### Person or Entity Authentication

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 27 | Cognito MFA available | pending | Cognito user pool MFA settings |
| 28 | Password complexity requirements | pending | Cognito password policy |
| 29 | Account lockout after failed attempts | pending | Cognito advanced security |

## Business Associate Agreements

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 30 | AWS BAA in place | pending | AWS Artifact |
| 31 | No third-party PHI sharing without BAA | pending | Vendor review |

## Breach Notification (45 CFR 164.400-414)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 32 | Breach notification process documented | pending | Incident response plan |
| 33 | 60-day notification to affected individuals | pending | Notification procedures |
| 34 | HHS notification for breaches > 500 | pending | Notification procedures |
| 35 | Annual HHS notification for breaches < 500 | pending | Annual reporting process |

## Minimum Necessary Standard

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 36 | API returns only necessary PHI per endpoint | pending | API response review |
| 37 | Lambda functions access only needed database fields | pending | SQL query review |
| 38 | Mac Mini receives only session-relevant patient data | pending | Session config review |
| 39 | No PHI in application logs | pending | `phi-log-scan.ts` |
| 40 | No PHI in error messages returned to client | pending | Error response review |

## Verification Date

Last verified: pending
Verified by: pending
