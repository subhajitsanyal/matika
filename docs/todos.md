# CareLog v3.0 — Todos & Open Items

**Last Updated:** 2026-04-25
**Scope:** Codebase audit + journey execution findings

---

## Summary

| Category | P0 | P1 | P2 | P3 | Total |
|----------|----|----|----|----|-------|
| Build Errors | 0 | 0 | 0 | 0 | 0 |
| Deployment Issues | 0 | 1 | 1 | 0 | 2 |
| Runtime Errors | 0 | 0 | 1 | 0 | 1 |
| Test Failures | 0 | 0 | 0 | 0 | 0 |
| Missing Implementations | 0 | 1 | 0 | 0 | 1 |
| Code Quality | 0 | 0 | 0 | 2 | 2 |
| Infrastructure Note | 0 | 0 | 0 | 1 | 1 |
| **Total** | **0** | **2** | **2** | **3** | **7** |

---

## Verification Matrix

| Component | Check | Result |
|-----------|-------|--------|
| Terraform | `terraform validate` | PASS |
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
| PT-23 Offline Sync | PARTIAL | Offline save works; backend sync fails (see JE-2) |
| PT-25 Patient Settings | PASS | Correct role-based visibility |
| PT-26 Mac Mini Offline | PASS | "Coming Soon" shown (expected) |
| Edge: App Restart | PASS | Session persists after force-stop |

---

## Open Items

### JE-1 [P1] Mac Mini AI models not downloaded
- **Impact:** 9 conversational journeys BLOCKED (PT-03, PT-04, PT-05, PT-06, PT-07, PT-08, PT-09, CG-02, CG-03)
- **Context:** `/opt/carelog/models/` does not exist. STT, LLM, TTS, and Vision services cannot start without models.
- **Action:** Download and install Whisper, Llama, Piper, and Florence-2 models per `mac-mini/scripts/download-models.sh`. Then re-run blocked journeys.

### JE-2 [P2] Emulator cannot resolve API Gateway hostname for backend sync
- **Impact:** FhirSyncWorker retries but never syncs to S3 from the emulator
- **Context:** DNS resolution for `7xhgzfiebc.execute-api.ap-south-1.amazonaws.com` fails inside the emulator. The app's offline-first architecture handles this gracefully (local Room DB save + retry). Not an app bug -- emulator network limitation.
- **Action:** Test sync on a physical device or configure emulator DNS. Alternatively, use `adb reverse` to proxy API Gateway through the host.

### JE-3 [P1] Cognito `relatives` group still exists alongside new `caregivers` group
- **Impact:** New user registrations via the app may be assigned to `relatives` if Terraform hasn't been applied. Post-confirmation Lambda handles both, but the old group should be cleaned up.
- **Context:** `caregivers` group was manually created (2026-04-25). Old `relatives` group still exists. Terraform cognito module defines `caregivers` but needs `terraform apply`.
- **Action:** Run `terraform apply` to align Cognito groups with Terraform state, then migrate any remaining users from `relatives` to `caregivers`.

### JE-4 [P2] Notification delivery not verified end-to-end
- **Impact:** CG-09 (threshold breach alert), CG-10 (missed measurement), PT-10 (reminder) journeys not executed
- **Context:** These require a linked caregiver-patient pair with configured thresholds and Firebase Cloud Messaging setup. FCM token registration requires the app to run on a device with Google Play Services and a valid `google-services.json`.
- **Action:** Set up FCM, link test patient to test caregiver, configure thresholds, log a high BP reading, verify push notification delivery.

---

## Remaining P3 Items (from codebase audit)

### CQ-1 [P3] Android: Room schema export not configured
- **File:** `app/src/main/java/com/carelog/fhir/local/database/FhirDatabase.kt:32`
- **Warning:** Schema export directory not provided to Room annotation processor (only shows in verbose build output)
- **Fix:** Apply Room Gradle plugin with `schemaDirectory` or set `exportSchema = false` in `@Database` annotation

### CQ-2 [P3] Web Portal: npm audit -- 20 moderate vulnerabilities
- **Source:** Transitive dependencies in dev toolchain (eslint, vite)
- **Fix:** Run `npm audit fix` or update affected packages

### IN-1 [P3] Terraform: Plan shows new resources to deploy
- **Context:** `terraform plan` succeeds but shows resources to add (new Lambdas, EventBridge rules, monitoring, S3 raw bucket not yet deployed). This is expected -- the v3.0 infrastructure has been defined but not applied.
- **Action:** Review plan output before running `terraform apply`

---

## Completed Items (2026-04-25)

| Item | What was done |
|------|---------------|
| V004 migration SQL bug | Fixed `::text` cast for enum comparison after RENAME VALUE; applied to RDS |
| Amplify config stale IDs | Updated `amplifyconfiguration.json` with correct Pool/Client IDs |
| testTag coverage gap | Added testTag to 26 composable files (44% -> 100% coverage) |
| Journey execution agents | Created `journey-runner.md` and `backend-verifier.md` agent definitions |
| Journey execution plan | Created `docs/journey-execution-plan.md` with 5-phase approach |
| Cognito `caregivers` group | Created group, moved test users to correct groups |

---

## Audit History

| Audit | Date | P0 | P1 | P2 | P3 | Total |
|-------|------|----|----|----|----|-------|
| Initial | 2026-04-25 | 13 | 7 | 6 | 3 | 29 |
| Post-fix round 1 | 2026-04-25 | 0 | 3 | 6 | 3 | 12 |
| Post-fix round 2 | 2026-04-25 | 0 | 0 | 6 | 3 | 9 |
| Post-fix round 3 | 2026-04-25 | 0 | 0 | 0 | 3 | 3 |
| Final (re-verified) | 2026-04-25 | 0 | 0 | 0 | 3 | 3 |
| **Post-journey execution** | **2026-04-25** | **0** | **2** | **2** | **3** | **7** |

**29 audit issues found -> 26 fixed -> 3 P3 remain. 4 new items from journey execution.**

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

*Updated after journey execution run -- 2026-04-25*
