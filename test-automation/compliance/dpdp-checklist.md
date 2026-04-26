# DPDP Act Compliance Checklist

Digital Personal Data Protection Act, 2023 (India) — CareLog Verification

## Data Localisation

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | All S3 buckets in ap-south-1 | pending | `data-localisation-verify.ts` |
| 2 | RDS instances in ap-south-1 | pending | `data-localisation-verify.ts` |
| 3 | No cross-region S3 replication | pending | `data-localisation-verify.ts` |
| 4 | No cross-region RDS read replicas | pending | `data-localisation-verify.ts` |
| 5 | CloudFront not used for PHI content | pending | Terraform review |
| 6 | Mac Mini data stays on-premises (LAN only) | pending | `mac-mini-cleanup-verify.ts` |

## Encryption

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 7 | S3 buckets use KMS encryption at rest | pending | Terraform `aws_s3_bucket_server_side_encryption_configuration` |
| 8 | RDS uses encryption at rest | pending | Terraform `storage_encrypted = true` |
| 9 | TLS 1.2+ in transit (API Gateway) | pending | API Gateway TLS policy |
| 10 | TLS 1.2+ in transit (RDS) | pending | RDS parameter group `rds.force_ssl = 1` |
| 11 | FHIR Observations encrypted with KMS | pending | S3 bucket policy |
| 12 | Interaction audio encrypted with KMS | pending | S3 bucket policy |

## Consent

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 13 | Patient consent captured before data collection | pending | `consent` Lambda; Android consent screen |
| 14 | Consent record stored with timestamp | pending | `consent` table in RDS |
| 15 | Consent can be withdrawn | pending | Account deletion flow |
| 16 | Caregiver consent for managing patient data | pending | Caregiver registration flow |

## Data Minimisation

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 17 | Only necessary PHI collected | pending | FHIR Observation schema review |
| 18 | Mac Mini stores no persistent patient data | pending | `mac-mini-cleanup-verify.ts` |
| 19 | Conversation audio deleted from Mac Mini after session | pending | `mac-mini-cleanup-verify.ts` |
| 20 | No PHI in application logs | pending | `phi-log-scan.ts` |

## Access Controls

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 21 | Cognito user groups enforce role-based access | pending | API Gateway authorizer config |
| 22 | Patients can only access own data | pending | Lambda authorization checks |
| 23 | Caregivers can only access linked patients | pending | Lambda `persona_links` check |
| 24 | Doctors can only access assigned patients | pending | Lambda `care_team` check |
| 25 | No direct database access (bastion + SSM only) | pending | Terraform security groups |

## Audit Logging

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 26 | All data access logged in audit_log table | pending | `audit-log` Lambda |
| 27 | CloudTrail enabled for S3 and RDS operations | pending | Terraform CloudTrail config |
| 28 | Audit logs tamper-proof (append-only) | pending | CloudTrail log file validation |

## Data Retention and Deletion

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 29 | Account deletion removes all patient data | pending | `account-deletion` Lambda |
| 30 | S3 lifecycle policy configured (7-year retention) | pending | Terraform S3 lifecycle rules |
| 31 | Intelligent-Tiering after 90 days | pending | Terraform S3 lifecycle rules |
| 32 | Glacier Deep Archive after 365 days | pending | Terraform S3 lifecycle rules |

## Breach Notification

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 33 | Breach notification process documented | pending | Ops runbook |
| 34 | 72-hour notification capability to DPBI | pending | Incident response plan |

## Verification Date

Last verified: pending
Verified by: pending
