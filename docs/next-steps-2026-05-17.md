# Next-steps kickoff — 2026-05-17

> **Audience:** the orchestrator opening this file in a fresh Claude Code session. Everything here is self-contained; you do not need prior conversation history. **Read this whole file before dispatching any subagent.**

## 0. Context you start from

The 2026-05-17 voice bench landed: Phase A (3 caregiver journeys) + Phase B (5 patient journeys) all PASS live in staging, plus four bug fixes (F39 client / F42 backend SM / F43 voice-onboard phone / F44 form-onboard email). Soak clock continues to **2026-05-22** (Stream H prod-prep target). See `docs/testing_todos_v2.md` and `docs/journeys_voice.md` for the verified evidence; see memory `v2_open_blockers_endofday_20260517.md` for the day-end snapshot.

This file specs four independent streams to land **before closed beta** (M1, July 2026). Each stream has its own subagent delegation plan, driver checklist, and verification gate. Pick the order based on the risk-ordering at the bottom of §1. Don't try to do all four in one session — they're independently committable, so commit + push at the end of each stream before starting the next.

**Mac mini Core Audio:** assume F41 will recur. The remote-TTS workaround on a second mac (`scripts/matika-tts-server.py` + `MATIKA_SAY_REMOTE_URL`) is the way to drive any voice verification. Memory `voice_harness_lessons.md` lessons 7–9 cover the gotchas.

---

## 1. Streams overview

| # | Stream | Risk | Bench access needed | Approx. effort |
|---|---|---|---|---|
| **A** | Cognito drift apply (`66ca57c`) | **High** — wrong move breaks auth for everyone | None | 1–2 hrs incl. plan-and-apply + smoke |
| **B** | CG-V2-16 backend (delete-patient + cascades) | Medium — destructive on DB | Optional (RDS verify suffices; full E2E needs Android) | 1 day |
| **C** | Crashlytics wire-in (Android) | Low — additive, no existing observability | Android build + adb only | 0.5–1 day |
| **D** | Runbook docs (3 new files) | Zero — pure writing | None | 0.5 day each, parallelizable |

**Risk-ordered recommendation:** **C → D → B → A**. Crashlytics is the highest-leverage low-risk win (no observability today). Runbooks unblock §7 of the launch plan. CG-V2-16 unblocks DPDP right-to-erasure. Cognito drift goes last because it requires the most caution and you should treat the previous three as "known-good baseline" before touching auth infra.

If pressed for time, **C alone** is the most valuable single stream (closes a real beta-gate gap in §3.1: "Crash reporting wired — currently neither configured, this is a real gap, not a checkbox").

---

## 2. Per-stream playbooks

### Stream A — Cognito drift apply

**Goal:** land the Cognito drift from commit `66ca57c` declaratively so the next non-targeted `terraform apply` doesn't undo unrelated fixes. Beta gate per `v2_launch_plan.md` §3.1: "Cognito drift from `66ca57c` resolved before any non-targeted `terraform apply`."

**Pre-read (mandatory before dispatching):**
- `infrastructure/terraform/modules/cognito/` — module definition
- `infrastructure/terraform/environments/dev/main.tf` + `staging/main.tf` — module usage
- Memory `terraform_lambda_drift_pattern.md` — the F2 pattern, why `-refresh=false` + `-target` matters
- Memory `dev_tfvars_plumbing_trap.md` — undeclared-variable warning hides real plumbing
- `git show 66ca57c` — what changed in the source that should be in state

**Subagent 1 — Explore (drift diagnosis):**
```
subagent_type: Explore
description: Diagnose Cognito drift since 66ca57c
prompt: |
  We have a known Cognito drift between Terraform state and the live AWS
  pool. The 2026-05-11 launch plan flags it as a beta-gate: "Cognito drift
  from 66ca57c resolved before any non-targeted terraform apply."

  Your job: produce a punch list of EXACTLY what is drifted in dev AND
  staging. For each environment:
    1. `cd infrastructure/terraform/environments/<env> && terraform plan
       -target=module.cognito -refresh-only -no-color | head -200`
    2. Capture every resource line where `~` (in-place update) or `-/+`
       (replace) appears.
    3. For each diff, identify which attribute and whether it's safe to
       drift-apply (e.g. schema attribute change is destructive; lambda
       trigger ARN drift is reapplyable; password policy is reapplyable).
    4. Cross-reference against `git diff 66ca57c..HEAD -- infrastructure/
       terraform/modules/cognito/`.

  Return:
    - Per-env table: resource | attr | direction | safe-to-apply | notes
    - Order of operations: dev first, then staging.
    - Any resources where `terraform apply -target=module.cognito` is
      INSUFFICIENT (because they're orchestrated via aws_cognito_user_pool
      schema and that one's destructive).

  DO NOT run any `terraform apply` — read-only diagnosis only.
  Report under 400 words.
```

**Orchestrator driver work (after subagent 1 returns):**
1. **Snapshot dev pool first.** Before any apply:
   ```
   aws cognito-idp describe-user-pool --user-pool-id <DEV_POOL_ID> --region ap-south-1 > /tmp/cognito-dev-snapshot-pre.json
   aws cognito-idp describe-user-pool --user-pool-id <STAGING_POOL_ID> --region ap-south-1 > /tmp/cognito-staging-snapshot-pre.json
   ```
2. **Apply dev with `-target=module.cognito`.** Per memory `terraform_lambda_drift_pattern.md`, this avoids the cognito-drift class regression on unrelated modules. Use `-refresh=false` if the subagent flagged refresh-side noise:
   ```
   cd infrastructure/terraform/environments/dev
   terraform plan -target=module.cognito -out=tfplan.cognito
   # Review the plan output line-by-line. Any DELETE on aws_cognito_user_pool itself = STOP.
   terraform apply tfplan.cognito
   ```
3. **Smoke-test dev auth.** Log in to the dev app as a known patient (Jane Doe per memory `jane_dev_test_account.md`), drive one observation turn end-to-end. Any auth failure → restore from snapshot via targeted attribute edits and surface to user.
4. **Repeat for staging.** Same flow. Smoke-test by signing in as `sanyalsubhajit2010+pt9@gmail.com` (Jane PT in staging) and driving one BP voice turn.
5. **Verify state-vs-live alignment.** Final `terraform plan -target=module.cognito` should show "No changes."

**Verification gate (must all hit before declaring done):**
- [ ] Both `dev` and `staging` `terraform plan -target=module.cognito` show "No changes."
- [ ] Dev Jane Doe login + 1 observation turn succeeds.
- [ ] Staging Jane PT login + 1 BP voice turn succeeds.
- [ ] `aws cognito-idp describe-user-pool` matches pre-snapshot for fields that should NOT have drifted (groups, app clients, lambda triggers).

**Stop-and-surface conditions:**
- Plan output proposes `-/+ destroy` on `aws_cognito_user_pool` — STOP. That would invalidate every existing user. Re-engage with user before any apply.
- Lambda trigger ARN drift but no obvious lambda code change in `git log` — STOP. Could mean the trigger lambda has its own out-of-band ARN (CI-deployed). Surface for owner.
- Smoke-test auth fails post-apply — STOP. Restore the drifted attribute via `aws cognito-idp update-user-pool` from the snapshot.

**Deliverables:**
- One commit per env if the plan landed cleanly: `Terraform — Cognito module realigned to 66ca57c (dev)` / `(staging)`. State files commit as part of the same change if they're tracked here.
- Update `docs/v2_launch_plan.md` §3.1 — flip "Cognito drift from `66ca57c` resolved" to ✓.
- Memory snapshot append to `terraform_lambda_drift_pattern.md` if any non-obvious lesson surfaced.

---

### Stream B — CG-V2-16 (delete-patient + cascading deletes)

**Goal:** verify the `delete-patient` lambda exists, fires on the Android caregiver-side delete flow, and cascades deletes correctly across `observations` (S3), `alerts`, `persona_links`, `interaction_sessions`, and Cognito. Required for DPDP right-to-erasure compliance. Beta-gate per `v2_launch_plan.md` §4.2.

**Pre-read (mandatory before dispatching):**
- `backend/lambdas/account-deletion/` and `backend/lambdas/<anything-matching-delete>/` — find the actual lambda. (List with `ls backend/lambdas/ | grep -i delete`.)
- `backend/database/migrations/V001__initial_schema.sql` — table list to confirm what needs cascade.
- `docs/journeys_non_voice.md` CG-V2-16 row — current PASS criteria.
- `docs/matika_spec_v2.md` — search for "delete" / "erasure" for the canonical contract.

**Subagent 1 — Explore (lambda + cascade inventory):**
```
subagent_type: Explore
description: Map delete-patient lambda + cascade surfaces
prompt: |
  Goal: produce a complete map of what "delete a patient" needs to touch
  so we can verify CG-V2-16 end-to-end.

  Find:
    1. The lambda that handles delete-patient (likely
       backend/lambdas/account-deletion/ or backend/lambdas/delete-patient/
       — check both; report which one is wired to the DELETE
       /patients/{patientId} API Gateway route).
    2. List every RDS table that has a FK reference to patients or that
       carries patient-derived data. Reference V001__initial_schema.sql
       through the latest migration in backend/database/migrations/.
    3. Identify the S3 prefix pattern for clinical data
       (s3://carelog-v2-staging-documents-*/observations/<patientId>/...).
    4. Identify the Cognito user attribute that ties a patient to their
       Cognito sub (probably custom:linked_patient_id).
    5. Identify any SQS queues, SNS topics, or scheduled tasks (EventBridge
       rules) that reference patient_id.

  For EACH cascade target, also state:
    - Is it already handled by ON DELETE CASCADE on the FK?
    - Or does the lambda need to explicitly delete it?
    - What's the desired post-delete state? (row removed, soft-deleted, or
      retained-but-anonymized for compliance backup?)

  Cross-reference against the Android Maestro flow for CG-V2-16
  (.maestro/flows/ — grep for delete or remove).

  Return a checklist mapped to lambda function vs. DB constraint vs. app
  flow. Under 500 words.
```

**Subagent 2 — Plan (only after subagent 1 reports gaps):**
Dispatch this only if subagent 1 found explicit gaps (e.g. "lambda doesn't delete S3 observations" or "alerts.patient_id has no cascade"). Otherwise skip.
```
subagent_type: Plan
description: Design delete-patient cascade fix
prompt: |
  Subagent 1 found the following gaps in delete-patient cascade behavior:
  <PASTE SUBAGENT 1 FINDINGS HERE>

  Design the minimum-surgical fix:
    1. Per-gap: is the right home a migration (V0XX_cascade_FKs.sql), a
       lambda change (backend/lambdas/<which>/index.js), or both?
    2. For migration changes: confirm reversibility + zero-downtime apply
       via Flyway over the bastion tunnel.
    3. For lambda changes: which order to delete in (FK constraint order
       matters: FK-dependents first, then patient row, then user row,
       then Cognito user, then S3 prune as best-effort).
    4. Audit-log row for the deletion event (audit_log table) — what
       fields, attributed to whom.

  Return a step-by-step diff plan with explicit file paths and SQL/JS
  pseudocode for each step. No code yet — just the architectural plan
  for review.
```

**Orchestrator driver work:**
1. Read subagent 1's checklist. If all cascades are already wired (FK ON DELETE CASCADE + lambda handles non-DB resources), skip subagent 2 and go straight to verification.
2. If subagent 2 ran: review the plan with the user before implementing. **Do not implement without sign-off.** This is destructive.
3. If implementing: write code, add unit tests in the lambda's `__tests__/` (or create the dir if missing — match the pattern from `bedrock-router/__tests__/handler.test.ts`), run `npm test`, deploy.
4. Live-verify on staging with a throwaway patient. Create one via the Android caregiver form-onboard, run the delete flow, then directly query staging RDS + S3 + Cognito:
   ```
   # SSM tunnel per memory dev_rds_ssm_tunnel.md but for staging:
   #   bastion i-0f2acdf1a96ee24a6, secret carelog-staging-db-password, db carelog_staging, local port 55433
   # Confirm zero rows: patients, users (cognito_sub=...), persona_links, observations metadata, alerts, interaction_sessions
   # Confirm S3 prefix is empty
   # Confirm Cognito user is gone
   ```

**Verification gate:**
- [ ] Lambda unit tests PASS (full suite, not just new tests).
- [ ] Lambda deployed to staging successfully (`LastUpdateStatus=Successful`).
- [ ] Android delete-patient flow on staging completes without error.
- [ ] **RDS evidence (must all be zero):** `patients`, linked `users`, `persona_links`, `interaction_sessions`, `alerts`, `parameter_configs`, `patient_topics`, `audit_log` for that patient's writes (or audit_log retained per compliance — confirm policy).
- [ ] **S3 evidence:** `s3://carelog-v2-staging-documents-*/observations/<patientId>/` returns zero objects.
- [ ] **Cognito evidence:** `aws cognito-idp list-users --filter "sub=\"<sub>\""` returns empty.
- [ ] Audit_log row exists with `action='DELETE', resource_type='patient', resource_id='<patientId>'`.

**Stop-and-surface conditions:**
- Subagent 1 finds the delete-patient lambda doesn't exist at all — STOP. CG-V2-16 PASS-by-architecture claim in `journeys_non_voice.md` is wrong; surface as a NEW finding.
- Live-verify shows orphan rows (e.g. `alerts.patient_id` referencing a now-deleted patient) — STOP. File as F45-class missing-cascade bug.

**Deliverables:**
- Commits per change (lambda code, migration if needed, Maestro flow updates).
- Flip `journeys_non_voice.md` CG-V2-16 row to "PASS — verified live YYYY-MM-DD" with the RDS/S3/Cognito triad cited.
- `testing_todos_v2.md` entry if any new F-class finding surfaced.

---

### Stream C — Crashlytics wire-in

**Goal:** integrate Firebase Crashlytics into the Android app so beta crashes are auto-reported with breadcrumbs. Closes the `v2_launch_plan.md` §3.1 gate: "Crash reporting wired (Sentry or Firebase Crashlytics). Currently neither is configured — this is a real gap, not a checkbox." Per memory `v2_stream_d_decisions_20260512.md`, Crashlytics was chosen over Sentry.

**Pre-read (mandatory before dispatching):**
- `android/app/build.gradle.kts` — already has Firebase? what versions?
- `android/app/google-services.json` — exists? which Firebase project?
- `android/app/src/main/AndroidManifest.xml` — Firebase init, internet permission.
- Memory `v2_stream_d_decisions_20260512.md` — confirms Crashlytics over Sentry.
- Existing crash points: `Log.e(TAG, ...)` and `throw` sites in `MatikaConversationViewModel.kt`, `BedrockTurnClient.kt`, etc.

**Subagent 1 — Explore (current Firebase footprint):**
```
subagent_type: Explore
description: Audit current Firebase/crash-reporting state in Android
prompt: |
  Goal: tell me exactly what's already wired for Firebase in the Android
  app, what's missing for Crashlytics, and what gradle/dependency changes
  are needed.

  Check:
    1. android/app/build.gradle.kts — list Firebase BoM version, every
       firebase-* dependency, every google-services / crashlytics gradle
       plugin reference.
    2. android/build.gradle.kts (root) — same for buildscript classpath.
    3. android/app/google-services.json — exists? which firebase project?
       (state, don't dump the file contents).
    4. AndroidManifest.xml — Firebase init, internet permission, any
       crashlytics-specific meta-data tags.
    5. Application/Hilt module — is there a CrashlyticsInitializer
       already? FirebaseApp.initializeApp call?
    6. Search for "Crashlytics" / "crash" string literals across the
       codebase. Anything pre-existing?
    7. Existing log/throw sites that should forward to Crashlytics:
       MatikaConversationViewModel error paths, BedrockTurnClient
       Result.failure paths, SttManager onError, ConversationStateMachine
       transition failures.

  Return:
    - Current state inventory (one table)
    - Diff of what needs to change in build.gradle.kts + AndroidManifest
    - List of recommended Log.e/throw sites that should also call
      Crashlytics.recordException or Crashlytics.log
  Under 500 words.
```

**Orchestrator driver work:**
1. Read subagent 1 inventory. Verify the Firebase project mapped in `google-services.json` is the right one for staging (and if separate, prod).
2. Add Crashlytics dependency to `android/app/build.gradle.kts`:
   ```
   implementation("com.google.firebase:firebase-crashlytics:<latest>")
   implementation("com.google.firebase:firebase-analytics:<latest>")  // recommended companion
   ```
   Plus the gradle plugin at the root level if not already there:
   ```
   plugins { id("com.google.firebase.crashlytics") version "<latest>" apply false }
   ```
   And `apply(plugin = "com.google.firebase.crashlytics")` in `android/app/build.gradle.kts`.
3. Wire forwarders at strategic catch sites. Minimal effective set:
   - **Bedrock failure** (`MatikaConversationViewModel.submitTurn` `Result.failure` path L425–429): `FirebaseCrashlytics.getInstance().recordException(err)`.
   - **State transition error**: same.
   - **STT error path** (`SttManager.onError`): `Crashlytics.log("STT err code=$code lang=$lang")` (NOT a recordException — STT errors are too noisy; log breadcrumb only).
   - **Lambda HTTP non-2xx**: in the `BedrockTurnClient` runCatching block, before bubbling: `Crashlytics.setCustomKey("last_lambda_status", status); Crashlytics.recordException(t)`.
   - **Hilt module initialization failures**: standard error path.
4. Add a debug-only test-crash button on `SettingsScreen` gated by `BuildConfig.DEBUG`:
   ```
   if (BuildConfig.DEBUG) {
     Button(onClick = { throw RuntimeException("crashlytics-smoke-test") }) {
       Text("Force test crash (debug only)")
     }
   }
   ```
5. Build, install on the bench phone, tap the test-crash button, force-quit and relaunch. Within ~5 minutes the crash should land in Firebase console.

**Verification gate:**
- [ ] `./gradlew :app:assembleDebug` succeeds with no Crashlytics-related warnings.
- [ ] App installs + launches normally; no startup crashes.
- [ ] Debug-only test-crash button visible in Settings (release build does NOT show it).
- [ ] Test crash recorded in Firebase Crashlytics console for the project bound to `google-services.json`.
- [ ] At least one `Crashlytics.log` breadcrumb visible alongside the crash (proves the breadcrumb forwarder is wired).
- [ ] Memory `v2_stream_d_decisions_20260512.md` updated to add "Crashlytics IMPLEMENTED YYYY-MM-DD".

**Stop-and-surface conditions:**
- The Firebase project mapped in `google-services.json` is a personal/dev project not appropriate for beta — STOP, surface the project-binding question to the user.
- Crash doesn't appear in console within 10 min — STOP. Verify network egress + DebugLogging mode.

**Deliverables:**
- One commit with the gradle/plugin/forwarder/test-button changes.
- Flip the launch plan §3.1 row to ✓.
- Memory update per above.

---

### Stream D — Runbook docs (3 new files)

**Goal:** land the three new runbooks listed in `v2_launch_plan.md` §6.2 (still-to-land pre-beta). These are docs, not code — fully parallelizable across three subagents.

**Pre-read (mandatory before dispatching):**
- `docs/v2_launch_plan.md` §6.2 — defines what each doc must cover
- `docs/v2_launch_plan.md` §7 (Operational Readiness) — context on what oncall is being set up to handle
- `docs/setup-and-deployment-guide.md` — existing operational reference; the new docs should not duplicate but should cross-link
- `docs/matika_spec_v2.md` — system contract for failure-mode reasoning

**Parallel subagent dispatch (send all three in a single message):**

```
subagent_type: general-purpose
description: Draft docs/runbook_oncall_v2.md
prompt: |
  Write docs/runbook_oncall_v2.md from scratch. Audience: an on-call
  engineer paged at 2 AM who needs to triage a Matika v2.0 production
  alert in under 5 minutes per page.

  Required sections:
    1. "First 60 seconds" — acknowledge page, open CloudWatch link,
       check incident status. Specific click-paths.
    2. Top-10 alerts table. For each alert: trigger condition (which
       CloudWatch alarm, what threshold), what it means in product
       terms, first 3 diagnostic steps (each citing a specific
       command — `aws logs ...`, `psql ...`, `aws lambda invoke ...`),
       common remediation, when to escalate.
    3. Common false-positives + how to suppress them.
    4. Escalation tree: who to page when (backend lead, frontend lead,
       infra lead). Use placeholder names — explicitly tagged `<TBD>`.
    5. Glossary: minimum operational vocabulary (FSM state names,
       session_type values, observation pipeline stages).

  Source material:
    - docs/v2_launch_plan.md §3.1 + §7.3 (alarms in scope)
    - docs/setup-and-deployment-guide.md (CloudWatch alarm list)
    - backend/lambdas/*/ — invocation patterns
    - docs/testing_todos_v2.md — known failure modes
    - Memory voice_harness_lessons.md — F41 + STT recovery patterns
  
  The 10 alerts to include MUST cover at minimum:
    - Bedrock 503 surge (cross-region failover not engaging)
    - RDS connection pool exhaustion
    - SNS push delivery failure rate
    - Cognito sign-in error rate
    - High guardrail block rate (potential false positives)
    - Lambda concurrency limit hit
    - WorkManager sync backlog growing
    - Observation S3 write failure
    - Alert delivery SLA breach
    - One Cognito drift detector
  
  Style: terse, scannable, every step is copy-paste ready. Section anchors
  consistent with the existing docs/ folder. No emojis, no marketing copy.
  
  Length: 600–900 lines.
  Return: the file content only, ready to write.
```

```
subagent_type: general-purpose
description: Draft docs/runbook_support_v2.md
prompt: |
  Write docs/runbook_support_v2.md from scratch. Audience: a support
  engineer fielding "patient can't X" / "caregiver can't X" tickets
  during beta.

  Required sections:
    1. Triage flow: how to identify a ticket as Matika v2.0 vs. v1
       legacy, how to identify which persona (patient / caregiver),
       how to extract the relevant identifiers (Cognito sub, patient_id
       short code, session_id).
    2. Top scenarios. For EACH:
       - "Patient can't log in"
       - "Patient can't log a vital via voice"
       - "Caregiver doesn't see their patient's data"
       - "Caregiver isn't getting alerts"
       - "Patient lost their temporary password"
       - "Patient is on Hindi/Bengali but app speaks English"
       - "Caregiver onboarded the wrong patient name"
       - "Patient gets stuck at the credentials form"
       - "Vital recorded in app but doesn't show in caregiver trends"
       For each scenario:
         - Symptom (caregiver/patient verbatim language)
         - Root-cause shortlist (3 most likely causes)
         - Diagnostic steps: explicit RDS query, CloudWatch search,
           Cognito attribute fetch, Android logcat grep recipe
         - Remediation: what support can do without escalating, what
           requires engineering escalation
    3. Common data-fix scripts: parameter_configs threshold update,
       Cognito password reset, language reset. Each is a single
       AWS-CLI or psql snippet.
    4. RDS access via SSM bastion (cross-link to setup-and-deployment-guide).
    5. PII handling: what NOT to copy into tickets.

  Source material:
    - docs/v2_launch_plan.md §7.4
    - Memory dev_rds_ssm_tunnel.md + jane_dev_test_account.md
    - docs/testing_todos_v2.md F39/F42/F43/F44 entries — those are the
      classes of "things that broke for real patients today"
    - Memory voice_harness_lessons.md — language-flip workaround

  Style: empathetic but technical. Every diagnostic step is copy-paste.
  600–900 lines.
  Return: the file content only.
```

```
subagent_type: general-purpose
description: Draft docs/dr_runbook_v2.md
prompt: |
  Write docs/dr_runbook_v2.md from scratch. Audience: an engineer
  responding to a disaster (RDS data loss, S3 region outage, Cognito
  user pool corruption).

  Required sections:
    1. Recovery objectives: RTO (recovery time objective) and RPO
       (recovery point objective) for each data class. Patient
       observations: target RPO 5min via S3 cross-region replication.
       RDS metadata: target RPO 5min via PITR. Cognito users: target
       RPO 1h via daily export.
    2. Backup architecture:
       - RDS PITR settings (35-day retention)
       - S3 cross-region replication config (mention the bucket name
         convention — confirm via terraform module)
       - Cognito user pool export schedule (Lambda + S3 archive)
    3. Recovery procedures. For each:
       - "RDS data corruption — restore to point in time": full
         step-by-step incl. SSM tunnel, restored-instance switchover,
         lambda env-var update, smoke verification
       - "S3 prefix accidentally deleted": s3 sync from replica, app
         FhirSyncWorker re-queue trigger
       - "Cognito user pool corrupted": admin-import from latest
         export, custom-attribute restore, user-pool client config
         re-apply
       - "ap-south-1 regional outage": fallback narrative + Bedrock
         cross-region inference, even though the rest of the stack
         is single-region for v2.0
    4. Drill schedule: quarterly tabletop, bi-annual live drill on
       staging (NEVER on prod).
    5. Communications template: customer-facing status page wording,
       cohort WhatsApp message templates.

  Source material:
    - docs/v2_launch_plan.md §3.2, §7.1, §7.2, §8
    - infrastructure/terraform/modules/rds/ + s3/ + cognito/
    - backend/lambdas/account-deletion/ (for the export pattern)

  Style: precise, version-stamped procedures. Every command is
  copy-paste with placeholders explicitly tagged `<PROD_RDS_ARN>` etc.
  500–800 lines.
  Return: the file content only.
```

**Orchestrator driver work:**
1. Dispatch all three subagents in **a single message with three tool calls** (parallel — they're independent).
2. When all three return, write each file to its target path. Read the user pre-read list yourself + spot-check the drafts for:
   - Hallucinated CloudWatch alarm names that don't exist (cross-reference `infrastructure/terraform/`).
   - Wrong RDS schema references (cross-reference V001 migration).
   - Inconsistent persona terminology (patient/caregiver/attendant — only these three exist in v2.0; "doctor" is Phase 2 per CLAUDE.md).
3. Add the three new files to `docs/v2_launch_plan.md` §6.2 — flip them from "still to land" to "landed YYYY-MM-DD".

**Verification gate:**
- [ ] All three docs exist at the target paths.
- [ ] Each doc is under 1000 lines and over 400 lines (signals depth without bloat).
- [ ] Every `aws` / `psql` command runs to completion in a dry-run sense (no syntax errors).
- [ ] No "doctor" persona terminology surfaces anywhere outside an explicit "Phase 2 deferred" callout.
- [ ] All cross-references to other docs resolve (`docs/foo.md` files exist).
- [ ] `docs/v2_launch_plan.md` §6.2 table updated.

**Stop-and-surface conditions:**
- A subagent hallucinates a CloudWatch alarm name or RDS table — STOP that file, re-dispatch with a tighter prompt scoped to actual existing names.
- The on-call alert list in §7.3 of the launch plan turns out to be aspirational rather than implemented — note in the runbook with "TARGET — alarm not yet wired" so it's clear.

**Deliverables:**
- 3 new files + 1 doc update committed together: `Docs — Operational runbooks for beta (oncall + support + DR)`.

---

## 3. Cross-cutting expectations (apply to every stream)

**Before starting any stream:**
- Run `git status` — ensure clean baseline (or at least, only pre-existing drift). The 2026-05-17 session left some uncommitted drift files (build.gradle.kts, amplifyconfiguration.json) — leave them alone unless directly related to the stream.
- Re-read the relevant memory file(s) for the stream.
- Create a session task list with TaskCreate covering the stream's verification gates.

**While working:**
- Use the F39 kickoff guidance: don't include pre-existing drift in commits unless directly relevant.
- For backend changes: `npm test` from the affected lambda dir, then `npm run typecheck` if it exists, before deploy.
- For Android changes: `./gradlew :app:assembleDebug` clean build before install. Watch for surprise drift via Gradle version catalog changes.
- For Terraform: ALWAYS `terraform plan -out=tfplan` first, review, then apply the saved plan. Never `terraform apply` without a saved plan in a stream that touches Cognito or RDS.

**After each stream:**
- Commit + push with descriptive subject matching the existing style (look at recent commits `52484a0`, `26d9f7b`, etc.).
- Update `docs/testing_todos_v2.md` or `docs/journeys_non_voice.md` if the work moves an item.
- Update `docs/v2_launch_plan.md` — flip the relevant checkbox in §3.1 or table row in §4.x.
- Memory: add or update one of:
  - For Stream A: append to `terraform_lambda_drift_pattern.md`.
  - For Stream B: new memory `cg_v2_16_cascade_pattern.md` documenting which cascade is owned where.
  - For Stream C: update `v2_stream_d_decisions_20260512.md` to mark Crashlytics IMPLEMENTED.
  - For Stream D: no memory needed (docs are the artifacts).
- Surface to user with a concise status under 200 words: what landed, what's deferred, what the next stream should be.

**Stop-and-surface in general (per CLAUDE.md):** any destructive op, any auth-affecting change, any commit on shared branches other than `main` — re-engage with user before acting. Treat the Cognito stream A with extra paranoia.

---

## 4. Decision tree — which stream first

```
Was the prior session bench-blocked or was F41 fresh?
  ├─ Yes — F41 still bench-blocking: pick Stream D (docs, no bench needed).
  └─ No — bench is open via remote-TTS:
       │
       Is user available for sync on a destructive op?
         ├─ Yes — Stream A (Cognito) is fine. Highest value because it
         │       unblocks every other terraform apply.
         └─ No — Stream C (Crashlytics). No destructive ops, closes a
                  real beta gate, doesn't need bench.

If you've already done one stream this session, prefer to commit + push
and END the session rather than chain. Cross-stream context-switching
within a single session has consistently produced worse work in this
project — see the 2026-05-16 attempt that tried Phase A + Phase B + F39
in one shot.
```

---

## 5. Pointers if any stream surfaces something unexpected

- **Unfamiliar lambda name:** `ls backend/lambdas/ | grep -i <keyword>` first. The naming pattern is `carelog-<env>-<verb>-<noun>` or `matika-<env>-<noun>`.
- **Unfamiliar terraform module:** `find infrastructure/terraform -name "*.tf" | xargs grep -l <keyword>`. The module/env split is `modules/<name>/` shared + `environments/<env>/` per-env wiring.
- **Cognito sub vs. RDS user.id:** Cognito sub is the canonical identity. `users.cognito_sub` is the FK back. Patient `patient_id` (the `CL-XXXXXX` short code) is independent of both.
- **Mac mini Core Audio wedge during voice verify:** see memory `voice_harness_lessons.md` lesson 7. Stop, switch to remote-TTS on the MacBook Air, continue. Do not waste cycles on `coreaudiod` restarts.
- **F41 / F40 still open:** structural fixes are out of scope for any of the four streams here. Don't let them sidetrack the work.

---

## 6. Done definition for THIS file

This file itself is done when **all four streams have landed** and the launch-plan §3.1 beta gates updated:
- [ ] Stream A → Cognito drift checkbox flipped to ✓
- [ ] Stream B → CG-V2-16 row in `journeys_non_voice.md` flipped to PASS
- [ ] Stream C → "Crash reporting wired" checkbox flipped to ✓
- [ ] Stream D → §6.2 table updated for all three runbooks

Then delete this file or rename it `docs/next-steps-2026-05-17-DONE.md` and link from MEMORY for future archeology.
