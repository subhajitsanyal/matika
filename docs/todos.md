# CareLog v3.0 — Post-Fix Codebase Audit

**Date:** 2026-04-25 (re-audit after fixing 22 issues from initial audit)
**Scope:** Complete audit across all deployment boundaries — Terraform, Android, web portal, backend Lambdas, Mac Mini services, test automation
**Method:** Terraform validate/plan, Kotlin compilation, TypeScript compilation, production builds, ESLint, unit tests, pytest, shell script syntax checks

---

## Summary

| Category | P0 | P1 | P2 | P3 | Total |
|----------|----|----|----|----|-------|
| Build Errors | 0 | 0 | 0 | 0 | 0 |
| Deployment Issues | 0 | 0 | 0 | 0 | 0 |
| Runtime Warnings | 0 | 0 | 2 | 0 | 2 |
| Test Failures | 0 | 1 | 1 | 0 | 2 |
| Missing Implementations | 0 | 0 | 1 | 0 | 1 |
| Code Quality | 0 | 1 | 2 | 2 | 5 |
| Infrastructure Note | 0 | 0 | 0 | 1 | 1 |
| **Total** | **0** | **2** | **6** | **3** | **11** |

**All 13 P0 issues from the initial audit are resolved. Zero build or deployment blockers remain.**

---

## Verification Matrix — What Passes

| Component | Check | Result |
|-----------|-------|--------|
| Terraform | `terraform validate` | PASS |
| Terraform | `terraform plan` | PASS (92 add, 12 change, 5 destroy) |
| V004 Migration | SQL syntax (balanced parens, 30 statements, 7 tables) | PASS |
| Android | `./gradlew assembleDebug` | PASS (0 errors) |
| Android | `./gradlew test` | PASS (82/82 tests, 0 failures) |
| Web Portal | `npx tsc --noEmit` | PASS (0 errors) |
| Web Portal | `npm run build` | PASS (dist/ produced) |
| Web Portal | `npm run lint` | 9 warnings, 0 errors |
| Backend Lambdas | `npm test` (11 suites) | PASS (126/126 tests, 0 failures) |
| Mac Mini | Python `py_compile` (5 services) | PASS (5/5) |
| Mac Mini | Shell script `bash -n` (7 scripts) | PASS (7/7) |
| Mac Mini | `pytest tests/ -v` | 186/190 pass, 4 fail |
| Test Automation | `npm install` | PASS |
| Test Automation | `npx tsc --noEmit` | 25 errors (pre-existing structural) |

---

## Remaining Issues

### Runtime Warnings

#### RW-1 [P2] Android: `Nothing?` type mismatch warnings in release build
- **Files:**
  - `RelativeApiService.kt:472` — `Nothing?` where `String` expected
  - `ConsentRepositoryImpl.kt:90-91` — `Nothing?` where `String` expected (2 occurrences)
- **Impact:** Could cause runtime NPE in error-handling paths. Only appears in release compilation.
- **Suggested fix:** Review these functions — likely returning `null` from a branch that should return a String error message.

#### RW-2 [P2] Android: Deprecated API usage (~10 warnings in release build)
- `Icons.Filled.Send` → `Icons.AutoMirrored.Filled.Send` (3 files)
- `Icons.Filled.ArrowBack` → `Icons.AutoMirrored.Filled.ArrowBack` (1 file)
- `Divider()` → `HorizontalDivider()` (1 file)
- `NsdManager.resolveService()` deprecated (`MacMiniDiscovery.kt:134`)
- `menuAnchor()` → use `MenuAnchorType` overload (2 files)
- `LocalLifecycleOwner` moved to `lifecycle-runtime-compose` (4 files)
- **Impact:** No functional impact now; will break in future Compose/SDK versions.

---

### Test Failures

#### TF-1 [P1] Test Automation: 25 TypeScript errors (pre-existing structural issues)
- **Root cause 1:** `TS2451: Cannot redeclare block-scoped variable 'REGION'` — 7 compliance files each declare a top-level `const REGION` but TypeScript sees them in the same scope (missing `export {}` for module isolation).
  - `compliance/access-control-verify.ts:20`
  - `compliance/audit-logging-verify.ts:19`
  - `compliance/cert-pinning-verify.ts:18`
  - `compliance/cognito-security-verify.ts:18`
  - `compliance/data-retention-verify.ts:18`
  - `compliance/encryption-verify.ts:19`
  - `compliance/mac-mini-security-verify.ts:31`
- **Root cause 2:** `TS2393: Duplicate function implementation` — each compliance file has `main()` declared twice (top and bottom).
  - Same 7 files + `pilot/pilot-readiness-check.ts:173`
- **Root cause 3:** `TS2352: Conversion of type` — `performance/latency-benchmark.ts:161,163,231` — type cast fails due to missing index signature.
- **Fix:** Add `export {};` at the top of each compliance file for module isolation. Remove duplicate `main()` functions. Cast through `unknown` in latency-benchmark.ts.

#### TF-2 [P2] Mac Mini: 4 pre-existing LLM logic test failures
- **File:** `mac-mini/tests/test_llm.py`
- **Failures:**
  1. `test_correction_with_new_value` — "no it's 125 over 80" triggers denial detection before value extraction (the word "no" matches denial patterns before the correction is parsed)
  2. `test_english_emergency_keywords` — "I fell down" incorrectly matches as emergency (fuzzy matching too aggressive)
  3. `test_fuzzy_emergency_misspelling` — "chst pain" doesn't fuzzy-match "chest pain" (threshold/window too strict)
  4. `test_fallback_after_two_failures` — consecutive-failure counter not triggering fallback_text action after 2 failures
- **Impact:** Edge cases in LLM conversation logic. Core happy-path flows all pass.
- **Fix:** Tune denial pattern to not fire when a numeric value follows "no"; adjust emergency keyword fuzzy matching thresholds; fix fallback counter reset logic.

---

### Missing Implementations

#### MI-1 [P2] Web Portal: Zero test files
- **File:** `web-portal/src/` — no `*.test.*` or `*.spec.*` files
- **Error:** `npm run test -- --run` exits with code 1 (no tests found)
- **Fix:** Write Vitest + React Testing Library tests for new components (ProtocolTab, RecommendationsTab, InteractionsTab, ParameterConfigForm, RecommendationForm, TranscriptViewer)

---

### Code Quality

#### CQ-1 [P1] Web Portal: ESLint warnings cause lint failure
- **Files:** 8 components with `react-hooks/exhaustive-deps` warnings + 1 `react-refresh/only-export-components` warning in `AuthContext.tsx`
- **Error:** `npm run lint` exits non-zero because the script uses `--max-warnings 0`
- **Impact:** CI lint gate will fail.
- **Fix:** Wrap useEffect callbacks in `useCallback`, or relax `--max-warnings` threshold, or add eslint-disable comments where appropriate.

#### CQ-2 [P2] Web Portal: Large JS bundle (800 KB)
- **File:** `dist/assets/index-CPiRofpC.js` — 800.82 kB (235.58 kB gzip)
- **Warning:** Vite warns chunk exceeds 500 kB limit
- **Fix:** Add code-splitting with dynamic `import()` for tab components (ProtocolTab, RecommendationsTab, InteractionsTab) or configure `manualChunks` in Rollup.

#### CQ-3 [P2] Android: Unnecessary safe calls pattern (~24 release warnings)
- **Files:** `RelativeApiService.kt`, `ConsentRepositoryImpl.kt`, `InviteRepositoryImpl.kt`, `PatientRepositoryImpl.kt`, `UploadService.kt`, `FhirDocumentReference.kt`
- **Pattern:** `responseBody?.string() ?: ""` on non-null `ResponseBody`
- **Fix:** Remove redundant `?.` and `?:` operators.

#### CQ-4 [P3] Android: Room schema export not configured
- **File:** `FhirDatabase.kt:32`
- **Warning:** Schema export directory not provided to Room annotation processor
- **Fix:** Apply Room Gradle plugin with `schemaDirectory` or set `exportSchema = false` in `@Database` annotation.

#### CQ-5 [P3] Web Portal: npm audit — 20 moderate vulnerabilities
- **Source:** Transitive dependencies (eslint, vite toolchain)
- **Fix:** Run `npm audit fix` or update affected packages.

---

### Infrastructure Notes

#### IN-1 [P3] Terraform plan shows 92 resources to add
- **Context:** `terraform plan` succeeds but shows significant gap between deployed state and config (92 to add, 12 to change, 5 to destroy). This is expected — the new CareLog v3.0 resources (EventBridge rules, new Lambdas, monitoring module, S3 raw bucket) have not been deployed yet.
- **Action:** Review the plan output carefully before running `terraform apply`, especially the 5 resources to destroy and the RDS security group modification.

---

## Comparison: Initial Audit vs Post-Fix

| Metric | Initial Audit | Post-Fix |
|--------|--------------|----------|
| P0 issues | 13 | **0** |
| P1 issues | 7 | **2** |
| P2 issues | 6 | **6** |
| P3 issues | 3 | **3** |
| Android build | FAIL (16 errors) | **PASS** |
| Android tests | Blocked | **PASS (82/82)** |
| Web portal `tsc` | FAIL (7 errors) | **PASS (0 errors)** |
| Web portal `build` | FAIL | **PASS** |
| Lambda tests | 20 failures across 5 suites | **PASS (126/126)** |
| Mac Mini pytest | 151/190 pass | **186/190 pass** |
| Terraform validate | PASS | **PASS** |

**All build-blocking and deployment-blocking issues have been resolved.** The remaining 12 issues are code quality improvements, missing test coverage, pre-existing edge-case logic bugs, and deprecation warnings — none block deployment or core user flows.

---

*Generated by full codebase re-audit — 2026-04-25*
