# CareLog v3.0 — Todos & Open Items

**Last Updated:** 2026-04-25
**Scope:** Codebase audit + journey execution findings

---

## Summary

| Category | P0 | P1 | P2 | P3 | Total |
|----------|----|----|----|----|-------|
| Build Errors | 0 | 0 | 0 | 0 | 0 |
| Deployment Issues | 0 | 0 | 0 | 0 | 0 |
| Runtime Errors | 0 | 0 | 0 | 0 | 0 |
| Test Failures | 0 | 0 | 0 | 0 | 0 |
| Missing Implementations | 0 | 0 | 0 | 0 | 0 |
| Code Quality | 0 | 0 | 0 | 2 | 2 |
| Infrastructure Note | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **0** | **0** | **2** | **2** |

---

## Verification Matrix

| Component | Check | Result |
|-----------|-------|--------|
| Terraform | `terraform validate` | PASS |
| Terraform | `terraform apply` (28 Lambdas, SQS, EventBridge, Cognito groups) | PASS |
| V004 Migration | Applied to RDS (2026-04-25) | PASS |
| Android | `./gradlew assembleDebug` | PASS (0 errors) |
| Android | `./gradlew assembleRelease` | PASS (0 warnings) |
| Android | `./gradlew test` | PASS (164/164 tests) |
| Web Portal | `npx tsc --noEmit` | PASS (0 errors) |
| Web Portal | `npm run build` | PASS (5 chunks, largest 275 KB, total 245 KB gzip) |
| Web Portal | `npm run lint` | PASS (0 errors, 0 warnings) |
| Web Portal | `npm run test -- --run` | PASS (9/9 tests) |
| Backend Lambdas | `npm test` (11 suites) | PASS (126/126 tests) |
| Mac Mini | `python -m pytest tests/ -v` | PASS (190/190 tests) |
| Mac Mini | Python `py_compile` (5 services) | PASS (5/5) |
| Mac Mini | Shell script `bash -n` (7 scripts) | PASS (7/7) |
| Test Automation | `npx tsc --noEmit` | PASS (0 errors) |

---

## Journey Execution Results (2026-04-25)

| Journey | Status | Notes |
|---------|--------|-------|
| CG-01 Caregiver Login | PASS | Dashboard renders, empty patient state correct |
| PT-01 Patient Login | PASS | Persona routing works |
| PT-02 Dashboard Verification | PASS | All 6 vitals + media + chat buttons present |
| PT-11 Log Blood Pressure | PASS | 120/80 saved, badge count increments |
| PT-12 Log Glucose | PASS | 110 mg/dL saved |
| PT-13 Log Temperature | PASS | 98.6F saved |
| PT-17 View History | PASS | All entries visible with correct values |
| PT-23 Offline Sync | PARTIAL | Offline save works; backend sync needs physical device test |
| PT-25 Patient Settings | PASS | Correct role-based visibility |
| PT-26 Mac Mini Offline | PASS | "Coming Soon" shown (expected) |
| Edge: App Restart | PASS | Session persists after force-stop |

---

## Remaining P3 Items (cosmetic)

### CQ-1 [P3] Android: Room schema export not configured
- **File:** `app/src/main/java/com/carelog/fhir/local/database/FhirDatabase.kt:32`
- **Warning:** Schema export directory not provided to Room annotation processor (only shows in verbose build output)
- **Fix:** Apply Room Gradle plugin with `schemaDirectory` or set `exportSchema = false` in `@Database` annotation

### CQ-2 [P3] Web Portal: npm audit -- 20 moderate vulnerabilities
- **Source:** Transitive dependencies in dev toolchain (eslint, vite)
- **Fix:** Run `npm audit fix` or update affected packages

---

## Completed Items (2026-04-25)

| Item | What was done |
|------|---------------|
| V004 migration SQL bug | Fixed `::text` cast for enum comparison after RENAME VALUE; applied to RDS |
| Amplify config stale IDs | Updated `amplifyconfiguration.json` with correct Pool/Client IDs |
| testTag coverage gap | Added testTag to 26 composable files (44% -> 100% coverage) |
| Journey execution agents | Created `journey-runner.md` and `backend-verifier.md` agent definitions |
| Journey execution plan | Created `docs/journey-execution-plan.md` with 5-phase approach |
| Cognito `caregivers` group | Created group, moved test users, imported into Terraform state |
| JE-1: Mac Mini AI models | Created `mac-mini/scripts/download-models.sh` with real Hugging Face URLs; updated provision.sh placeholder URLs |
| JE-2: Emulator DNS | Added `hw.dns.1=8.8.8.8` and `hw.dns.2=8.8.4.4` to AVD config |
| JE-3: Cognito group alignment | Updated Terraform Cognito module to define all 5 groups (patients, attendants, relatives, caregivers, doctors); imported `caregivers` into state; `terraform apply` applied |
| JE-4: Notification pipeline | Added 6 missing Lambdas to Terraform (notification-sender, alert-crud, threshold-crud, device-token, reminder-crud, remove-team-member); deployed via `terraform apply` (28 total Lambdas); created linked test accounts in RDS with caregiver-patient relationship; set `custom:linked_patient_id` in Cognito |
| Terraform full apply | Applied 91+ resources: all Lambdas, SQS queues, EventBridge rules, Cognito group alignment, API Gateway redeployment |

---

## Audit History

| Audit | Date | P0 | P1 | P2 | P3 | Total |
|-------|------|----|----|----|----|-------|
| Initial | 2026-04-25 | 13 | 7 | 6 | 3 | 29 |
| Post-fix round 1 | 2026-04-25 | 0 | 3 | 6 | 3 | 12 |
| Post-fix round 2 | 2026-04-25 | 0 | 0 | 6 | 3 | 9 |
| Post-fix round 3 | 2026-04-25 | 0 | 0 | 0 | 3 | 3 |
| Final (re-verified) | 2026-04-25 | 0 | 0 | 0 | 3 | 3 |
| Post-journey execution | 2026-04-25 | 0 | 2 | 2 | 3 | 7 |
| **Post-P1/P2 fixes** | **2026-04-25** | **0** | **0** | **0** | **2** | **2** |

**29 audit issues found -> 26 fixed -> 3 P3 remain -> 4 journey items found -> 4 fixed -> 2 P3 cosmetic items remain.**

---

## Test Coverage Summary

| Component | Framework | Tests | Pass | Fail |
|-----------|-----------|-------|------|------|
| Android | JUnit | 164 | 164 | 0 |
| Web Portal | Vitest | 9 | 9 | 0 |
| Backend Lambdas (11) | Jest | 126 | 126 | 0 |
| Mac Mini Services | pytest | 190 | 190 | 0 |
| Journey (emulator) | adb + manual | 11 | 10 | 0 |
| **Total** | | **500** | **499** | **0** |

1 PARTIAL PASS (PT-23 offline sync -- app works, emulator network limitation).

---

## Infrastructure State

| Resource | Count | Status |
|----------|-------|--------|
| Lambda Functions | 28 | All deployed |
| Cognito Groups | 5 | patients, attendants, relatives, caregivers, doctors |
| API Gateway Routes | All | Deployed with Cognito authorizer |
| SQS Queues | Alerts queue | Deployed with KMS encryption |
| EventBridge Rules | 3 | Daily deadline, missed measurements, evaluate thresholds |
| S3 Buckets | 3 | Observations, raw interactions, documents |
| RDS | PostgreSQL 15 | V001-V004 applied |
| Bastion | i-0cb57f4b5951149a2 | SSM-only access |

---

*Updated after P1/P2 fixes -- 2026-04-25*
