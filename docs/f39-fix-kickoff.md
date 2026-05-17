# F39 fix — kickoff prompt

Paste the block below as the first message of a new Claude session. Single-task scope: ship a fix for **F39** and verify it live on staging. Stay focused — do not drift into other backlog items.

The orchestrator will auto-load all memory pointers in `MEMORY.md`. Re-read the two memory snapshots called out below before touching code — they encode why the bench saw what it saw.

---

```
You are fixing a single open finding: **F39** — F23 voice patient
onboarding's typed contact-form Submit button stays disabled, leaving
caregivers silently stuck after the voice conversational phase
completes. The authoritative description is in
`docs/testing_todos_v2.md` (search for "### F39"). Read it first.

## State at session start (verify before touching code)

1. `git pull origin main`. Last pushed commit was `8edb9b1`
   ("Voice bench results 2026-05-16 post-reboot — Phase A 0/3 PASS …").
   If HEAD doesn't match, surface and stop.
2. Read `docs/v2_launch_plan.md` v1.2 §1 + §3.1 (beta gates) so you
   understand why F39 matters — it blocks the caregiver-side voice
   patient onboarding path end-to-end.
3. Read these memory files in order — load-bearing for this fix:
   - `v2_open_blockers_endofday_20260516.md` — captures the bench
     session that found F39, F40, F41. Note that the F39 bench
     evidence (Submit enabled=false despite valid-looking inputs)
     may have a **test-methodology cause** (soft-keyboard layout
     shift causing the second tap to miss the phone field) on top
     of the real UX bug. Verify which it is in §"Reproduce" below
     before assuming.
   - `v2_open_blockers_endofday_20260515.md` — historical context
     for what the 2026-05-16 bench-fix wave (F30–F38) shipped. F23
     entry path is wired; F30 schema fix landed; F32 state-badge
     fix landed. The voice conversational phase is known-good up
     to the credentials form.
   - `feedback_verify_live_pattern.md` — fix-then-verify-live with
     RDS row + CloudWatch log + device behavior. **Non-negotiable.**
     Required evidence in §"Verify live" below.
   - `jane_dev_test_account.md` — dev test pair. Don't touch.
   - `dev_rds_ssm_tunnel.md` — dev access pattern. **For staging**
     use the staging variant (different secret name, port 55433):
     - Bastion: `i-0f2acdf1a96ee24a6`
     - RDS endpoint: `carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com`
     - Local port: `55433`
     - Secret name: `carelog-staging-db-password` (NOT
       `carelog/staging/rds_password` — old name in pre-2026-05-16
       runbooks)
     - Secret shape: JSON keys `dbname=carelog_staging`,
       `username=carelog_staging_admin`, `password`, `host`, `port`
     - SSM tunnel auto-exits when psql disconnects — batch queries
       into one `psql <<SQL ... SQL` heredoc per session
   - `voice_harness_lessons.md` — only if you re-bench voice. The
     2026-05-16 session ran loud-bench on Mac mini Speakers @ 50%
     (not the earbud-taped rig); see F41 below before assuming
     voice is available.
   - `terraform_lambda_drift_pattern.md` — only if you touch
     backend. F39 is Android-only by current diagnosis; if you find
     a backend root cause, surface and reassess scope.
4. Verify staging Cognito caregiver login still works:
   - Email: `sanyalsubhajit2010+cg@gmail.com`
   - Password: `BenchStg2026.` (reset 2026-05-15 via
     `admin-set-user-password --permanent`)
   - If rejected, reset again via
     `aws cognito-idp admin-set-user-password --user-pool-id
     ap-south-1_7cACPnKJn --username
     <sub-from-list-users-filter-email> --password 'BenchStg2026.'
     --permanent --region ap-south-1`. Then `pm clear com.carelog`
     on RFCT10C1GSZ before re-login (Amplify cache trap).
5. **Do not bench voice** as the first action. F41 (Core Audio
   wedge regression) is still open and tends to recur within
   ~25 min of `say -v Rishi` driving. Use the bare-form repro in
   §"Reproduce" instead — it isolates the F39 bug from F41 noise.

## Hard scope rules

- **F39 only.** Do not touch F40 (text-fallback no-op) or F41 (Core
  Audio wedge) in this session unless your F39 fix is blocked on
  them — and even then, surface before pivoting.
- **No other backlog items.** No Stream A5 dashboards, no Stream
  E runbooks, no Stream G doc edits, no Cognito-drift work. If
  you see something tempting, note it and move on.
- **Android-only by current diagnosis.** The form's
  enablement predicate is purely client-side
  (`MatikaConversationScreen.kt:245` —
  `val submitEnabled = email.isNotBlank() && phone.isNotBlank()`).
  The form doesn't POST anywhere — it caches credentials in the
  ViewModel via `MatikaConversationViewModel.onPatientCredentialsSubmitted`
  (line 439) and the next voice turn includes them in the
  TurnRequest. If your fix stays in
  `android/app/src/main/java/com/carelog/inference/`, that's
  expected. A backend touch would be out-of-scope drift.
- **Don't break the conversational phase** — it's proven working
  from CG-V2-04 turns 1–8 on 2026-05-16. Preserve the
  `awaitingPatientCredentials` flag, the
  `submittedPatientCredentials` cache, and the dialog dismiss
  semantics (`onPatientCredentialsDismissed` re-opens on next LLM
  pause_session emit per the comment at line 449–453).
- **iOS is parked.** Don't touch `ios/`.

## The bug — what's wrong

After F23 voice conversation reaches the contact-credentials
collection step, `PatientCredentialsDialog`
(`MatikaConversationScreen.kt:239-299`) renders with two
`OutlinedTextField` (email + phone) and a Submit `Button`. The
button's `enabled` is bound to
`val submitEnabled = email.isNotBlank() && phone.isNotBlank()`.

Two problems:

1. **No surface for invalid/empty state.** When the user taps
   Submit while disabled, nothing happens — no toast, no error
   text, no highlighted field. The user has no idea what's
   missing. On the 2026-05-16 bench, a soft-keyboard layout shift
   caused an `adb shell input text` to miss the phone field; the
   on-device user equivalent is "typed phone too late / scrolled
   the form / IME consumed input" — same dead-end UX. Per the
   F23 spec, this is a caregiver's first interaction with the
   product after talking through 6+ conversation turns — the
   silent-disabled Submit is a launch blocker by UX, not just by
   bench instrumentation.

2. **No format validation.** `isNotBlank()` accepts garbage —
   "foo" / "x" passes. The downstream
   `submittedPatientCredentials` cache feeds into the next
   TurnRequest, which feeds the LLM, which feeds
   `create-patient-from-voice`. Invalid email/phone formats
   propagate silently until the lambda errors — caregiver sees
   the conversational LLM responding (or 503ing) instead of an
   immediate "that email isn't valid."

## Reproduce — bare repro (no voice harness needed)

The F23 voice flow auto-opens the credentials dialog when the LLM
emits `pause_session{reason: awaiting_patient_credentials}`. You
don't need to drive 8 voice turns to repro the form bug — the
dialog component is independently testable:

**Option A (preferred — fastest):** Author a single
`@Preview` composable that renders `PatientCredentialsDialog`
directly, or add a Compose UI test that triggers the dialog and
asserts on field/button states. Add it to
`android/app/src/test/.../inference/PatientCredentialsDialogTest.kt`
or appropriate test source set. Doesn't need staging or a device.

**Option B (if you want the live UX):** Drive CG-V2-04 voice
turns to reach the dialog. Risks F41 mid-flight. If you do this:
- Audio setup: Mac mini Speakers @ 50% volume, phone near Mac.
  Do **not** use `scripts/matika-say.sh` (its
  `SwitchAudioSource -s "External Headphones"` re-assert is the
  suspected F41 trigger). Use bare
  `say -v Rishi -r 165 "<utterance>"` after setting
  `SwitchAudioSource -s "Mac mini Speakers"` once.
- Drive turns 1–7 per the runbook
  `docs/runbook_voice_bench_post_reboot_20260516.md` §4 CG-V2-04
  table. Keep utterances short to avoid Soda end-of-speech
  truncation.
- When the dialog appears (turn 8 area), reproduce the
  silent-Submit-disabled state and the soft-keyboard layout
  shift to confirm both UX gaps live.

## Fix candidates (pick one or combine)

1. **Surface a field-level helper text on empty/invalid.** Each
   `OutlinedTextField` gains a `supportingText` and `isError`
   binding driven by the same predicate that gates Submit. Email
   field: empty → "Required" / non-blank but invalid format →
   "Looks like a typo — check the email." Phone field: empty →
   "Required" / non-E.164 → "Use country code, e.g. +91…".
   Lowest blast radius. Owner stays `android-app`.

2. **Make Submit always tappable; surface validation on submit.**
   Remove the `enabled = submitEnabled` binding. On tap, validate
   both fields and either submit or surface a `Snackbar` /
   AlertDialog body update describing what's wrong. Pro: no
   silent-disabled mystery. Con: deviates from Material guidance
   that disables affirmative buttons until valid.

3. **Both #1 and #2 (recommended).** Helper text guides while
   typing; Submit being always-tappable means a tap is never
   ignored. Belt-and-suspenders for a first-impression
   caregiver flow.

Whichever path you pick, also add **format validation** for both
fields (not just `isNotBlank`):
- Email: at minimum a regex like
  `Patterns.EMAIL_ADDRESS` (Android-stdlib).
- Phone: E.164 — leading `+`, 8–15 digits, no spaces. Strip
  user-typed spaces/dashes before validating, persist the
  cleaned form to `submittedPatientCredentials`.

## Code surface

Primary file: `android/app/src/main/java/com/carelog/inference/ui/MatikaConversationScreen.kt`
- L239-299 — `PatientCredentialsDialog` (the component to fix)
- L243-245 — the empty-state local + `submitEnabled` predicate

Adjacent (read but typically don't modify):
- `android/app/src/main/java/com/carelog/inference/MatikaConversationViewModel.kt`
  - L116, L142, L155, L208, L419 — `awaitingPatientCredentials`
    state flow + when it opens
  - L439-446 — `onPatientCredentialsSubmitted(email, phone)` — the
    cache-and-close handler. The `.trim()` is here; if your fix
    pre-cleans before persistence, decide whether to keep both
    or hoist trimming to the dialog.
  - L448-456 — `onPatientCredentialsDismissed` — preserves the
    "re-open on next pause_session" semantic. Don't change.

If you add tests:
- `android/app/src/test/java/com/carelog/inference/`
  (Robolectric / Compose UI test pattern — check existing
  neighbor tests for the project's conventions before
  scaffolding).

## Verify live on staging (non-negotiable, per memory feedback_verify_live_pattern)

Three pieces of evidence required before declaring F39 done:

1. **Device behavior** — fresh APK installed on RFCT10C1GSZ,
   caregiver logged in, voice flow reaches the dialog (or
   surface the dialog via a debug entry point if you added
   one), and:
   - Submit-disabled state shows visible "Required" /
     "format-invalid" helper text under whichever field is
     missing/wrong.
   - Tapping a now-tappable Submit with valid inputs closes the
     dialog and lets the conversation continue.
   - Tapping Submit with an invalid email/phone surfaces the
     validation reason inline rather than silently rejecting.

2. **RDS row** — completing the F23 voice flow end-to-end with
   valid credentials creates a new `patients` row on staging
   RDS. Query:
   ```sql
   SELECT p.patient_id, u.name, u.email, p.created_at
     FROM patients p JOIN users u ON u.id = p.user_id
    WHERE p.created_at > now() - interval '30 minutes'
   ORDER BY p.created_at DESC LIMIT 5;
   ```
   Expect the freshly-created test patient at the top.
   `interaction_sessions` (NOT `observations` — that table
   doesn't exist; observations are S3-only per CLAUDE.md) should
   show a session with `fsm_state IN ('PROFILE_CONFIRMED',
   'COMPLETE')` for the caregiver flow.

3. **CloudWatch log** — `/aws/lambda/carelog-staging-create-patient-from-voice`
   shows "Patient created: CL-XXXXXX" for the same RequestId
   that fired the credentials-bearing turn. Tail:
   ```bash
   aws logs tail /aws/lambda/carelog-staging-create-patient-from-voice \
     --since 15m --region ap-south-1
   ```
   Cross-reference the RequestId with
   `/aws/lambda/matika-staging-bedrock-router` to confirm the
   credentials passed through the router into the lambda.

If voice is wedged again by F41 mid-verification, surface and
stop — fall back to unit/UI-test evidence on item #1 and call
out the live-bench gap explicitly. Don't fabricate verification.

## Test patient identifiers (use, don't pollute Jane)

Today's staging RDS contains:
- `Jane PT` (CL-012W6M) — pre-existing, do not delete
- `Asha Devi` (CL-TPUX54,
  `sanyalsubhajit2010+staging-pt@gmail.com`)
- `Priya Nair` (CL-R18V51, `subhajit.sanyal+att1@gmail.com`)

For F39 live-verify, create a fresh test patient (e.g. Rajiv with
email `sanyalsubhajit2010+at@gmail.com` — confirmed fresh in
Cognito as of 2026-05-16). If you need to pivot to a different
email because that one no longer fresh, check Cognito first:
```bash
aws cognito-idp list-users --user-pool-id ap-south-1_7cACPnKJn \
  --region ap-south-1 --filter 'email="<candidate>"' \
  --query 'Users[].Username' --output text
```
Empty output = fresh.

## When you finish

1. **Update docs:**
   - `docs/testing_todos_v2.md` — flip F39 header to
     "(RESOLVED — verified live YYYY-MM-DD)" and add a
     `**Live evidence (YYYY-MM-DD):**` block with the three
     evidence items above.
   - `docs/journeys_voice.md` — flip the CG-V2-04 row's status
     to PASS (or PASS-with-caveat if voice retest was blocked
     by F41), cite this session's commit + RequestId.
2. **Update memory:**
   - Update `v2_open_blockers_endofday_20260516.md` — change F39
     entry from open → resolved, update PASS count if
     CG-V2-04 flipped, leave F40 + F41 unchanged.
   - If your fix surfaced a related design lesson worth
     remembering (e.g. Compose `AlertDialog` field-validation
     pattern, soft-keyboard layout-shift in `adb` tests), write
     a new memory file and link it from `MEMORY.md`.
3. **Commit + push:**
   - Commit message style — match recent history (e.g.
     `git log --oneline -5`):
     - Concise subject
     - Body explains the fix + the live-evidence triad
     - `Co-Authored-By: Claude Opus 4.7 (1M context)
       <noreply@anthropic.com>` trailer
   - Push to `origin/main`. The user's working tree had a few
     un-relevant pre-existing modifications at session start
     (e.g. `docs/launch-execution-3-kickoff.md`,
     `android/app/build.gradle.kts`,
     `*/amplifyconfiguration.json`); do not include those in
     your commit unless directly relevant to F39.

4. **Final report to the user** — under 200 words, covering:
   - What changed (files + line count)
   - Live evidence triad (RDS row id, CloudWatch RequestId,
     device-behavior summary)
   - Whether voice retest was completed or deferred (F41
     status)
   - What's now next from the beta-gate list (the user's view
     of remaining work — see the summary I gave them after the
     2026-05-16 bench).

Surface immediately if any of the following happen:
- F39 fix turns out to require a backend change (out-of-scope
  drift)
- Voice retest hits F41 partway through verification
- Staging Cognito password rejects multiple resets
- Any other unexpected state that wasn't covered above
```
