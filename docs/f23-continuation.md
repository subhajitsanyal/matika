# F23 voice patient onboarding — continuation kickoff prompt


The prior session made all the load-bearing architecture decisions and verified the backend half end-to-end against synthetic input. Don't re-litigate those decisions; they're documented in the PRD / spec / testing_todos and summarized below.

---

```
Continuing Matika v2 F23 (voice patient onboarding) from a prior session.
Steps 1-3 are committed at `f6caff5` and deployed to dev. Steps 4-5
(Android UI + end-to-end smoke) remain.

The PRD + spec set the contract; the backend half is wired and live.
Your job is to wire the Android UI to the existing backend and run an
end-to-end smoke against a synthetic test caregiver.

Authoritative state — read these in order:

1. `docs/matika_prd_v2.md` §6.3.1 / §8.1 / §6.5 — voice patient profile
   extraction product spec. Field set, persistence boundary, escape
   hatch, edge cases.

2. `docs/matika_spec_v2.md` §4.5 + §6.9 — backend contract.
   `POST /patients/from-voice` shape, two-pass session shape,
   placeholder bootstrap path, mid-session pivot mechanics, FSM
   additions, structured-output `patientProfile` block.

3. `docs/testing_todos_v2.md` F23 entry + this file (`f23-continuation.md`)
   — what's been done, what's left, what to verify before starting.

4. MEMORY.md (auto-loaded) — bench setup, dev RDS access, test
   accounts, terraform drift pattern, voice harness lessons.

# What Steps 1-3 already shipped (verified live, do NOT redo)

Schema:
  - V008 — interaction_sessions.patient_id NULLable for caregiver_onboarding
  - V009 — fsm_state_check accepts EXTRACTING_PROFILE,
    AWAITING_PROFILE_CONFIRMATION, PROFILE_CONFIRMED

Backend Lambdas (deployed):
  - matika-dev-bedrock-router — F23 two-pass FSM + placeholder
    bootstrap + mid-session pivot calling create-patient-from-voice.
    Uses new prompt prompts/system_v2_caregiver_onboarding_profile.md
    when fsmState in {EXTRACTING_PROFILE, AWAITING_PROFILE_CONFIRMATION}.
    Skips model_call telemetry on placeholder turns (5-10 turn gap;
    full coverage post-pivot). Streaming handler does NOT have F23
    pivot logic — Android client must use non-streaming endpoint
    for caregiver_onboarding turns.
  - carelog-dev-create-patient-from-voice — direct-invoke target.
    Atomically creates Cognito user + RDS rows + UPDATEs
    interaction_sessions.patient_id from NULL → real UUID. Sends
    welcome email via SES. Rolls back Cognito user on RDS failure.

Terraform — bedrock-router env CREATE_PATIENT_FROM_VOICE_FN_NAME wired,
IAM lambda:InvokeFunction grant on bedrock_router_inline policy, SES
SendEmail added to lambda_rds_cognito role.

# What's left

Step 4 — Android UI wiring (~1-2h):

  4.1. Add a secondary FAB on `CaregiverHomeScreen` titled "Add Patient
       via Conversation" with testTag `add_patient_voice_fab`. Place
       it above (or alongside) the existing `onboard_patient_fab`. The
       new FAB navigates to a new Compose route that mounts
       `MatikaConversationScreen` with `patientCognitoSub =
       "pending-<sessionId>"` (synthetic sentinel — bedrock-router
       resolves these to placeholder PatientContext on every turn
       until the mid-session pivot lands).
  4.2. Generate the sessionId on the client BEFORE navigation; it
       becomes both the conversation's session id AND the suffix of
       the placeholder patientCognitoSub. The existing
       `MatikaConversationViewModel.startSession()` generates its own
       session id today — extend it (or thread through nav args) so
       it accepts an externally-provided session id when in voice-
       patient-onboarding mode.
  4.3. The orphan `PatientOnboardingConversationScreen` +
       `CaregiverOnboardingViewModel` target the dead v1 Mac Mini
       stack (MacMiniLlmApi/MacMiniSttApi/MacMiniTtsApi). Don't try to
       resurrect them. Either delete them or leave them orphaned for
       the v1 cleanup pass — your call.
  4.4. Form modal for email + phone. When the LLM emits
       `pause_session` with `reason: 'awaiting_patient_credentials'`,
       surface a small AlertDialog with two TextFields (email,
       phone). On Submit, the dialog closes and the conversation
       resumes; the ViewModel stores the credentials and includes
       them in `TurnRequest.patientCredentials` on every subsequent
       turn until session-end. testTags `patient_credentials_email`,
       `patient_credentials_phone`, `patient_credentials_submit`.
  4.5. "Use form instead" escape button visible in the conversation
       UI throughout the placeholder phase. Tapping it fires
       `POST /sessions/{id}/end` (F2's existing endpoint) to clean
       up the placeholder session row, then navigates to
       `PatientOnboardingScreen` (the form-based v2 onboarding
       already wired in `CareLogNavHost.kt:268-294`). Optional:
       pre-populate the form with whatever profile fields the LLM
       captured before bailout (those are in the last turn's
       response sessionState, but threading them through requires
       more nav args — defer unless trivial).
  4.6. Force `clientHints.preferStreaming = false` on the bedrock-
       router request when `sessionType === CAREGIVER_ONBOARDING`
       AND the placeholder patientCognitoSub is in use. The
       streaming handler doesn't have F23 pivot logic; the non-
       streaming `/conversation/turn` is the only correct endpoint
       for voice patient onboarding.

Step 5 — End-to-end smoke (~30min):

  5.1. Build APK, install on test device.
  5.2. Pre-flight: confirm John CG's `custom:linked_patient_id`
       Cognito attribute points somewhere reasonable. The voice-
       patient-onboarding flow doesn't use it but other tests do.
  5.3. Sign in as John CG (caregiver). Tap the new FAB.
  5.4. Drive the conversation: "Set up monitoring for my mother
       Asha Devi, age 68, with hypertension." Use voice input
       (the harness pattern) — the LLM should ask follow-ups for
       missing fields, then trigger the form modal.
  5.5. Type a synthetic email + phone in the form modal.
       Recommended: f23-smoke-2026-05-10@example.invalid +
       +91 99999 99999. The lambda generates a random temp
       password and emails it; the synthetic .invalid domain
       won't actually deliver.
  5.6. LLM reads back the profile → say "yes" → pivot fires.
  5.7. Verify in dev RDS:
       - new `patients` row with the captured profile
       - new `users` row, persona_type='patient', cognito_sub matches
         response
       - new `persona_links` row, John CG → new patient,
         relationship='caregiver', is_active=true
       - placeholder `interaction_sessions` row's patient_id
         UPDATEd from NULL → real UUID
  5.8. Verify CloudWatch on bedrock-router for
       `caregiver_onboarding pivot ok` log line.
  5.9. Continue the conversation into protocol setup. Verify
       `parameter_configs` rows get persisted at the FINAL
       complete_session via the existing T-V2-302 path.
  5.10. Cleanup test data after smoke (DELETE patients +
       users + persona_links rows; DELETE Cognito user via
       admin-delete-user with the cognito_sub UUID as Username).

# Approach guidance

- The backend is in a clean state. Don't redeploy bedrock-router or
  create-patient-from-voice unless you genuinely need to — the F23
  changes are deployed. Run `aws lambda get-function --function-name
  matika-dev-bedrock-router --query 'Configuration.LastModified'` to
  verify the deploy timestamp matches the f6caff5 commit time
  (~2026-05-10 03:25Z).

- Check the live state of dev RDS at session start:
    psql> \d interaction_sessions  # patient_id should be nullable
    psql> SELECT enumlabel FROM pg_enum WHERE enumtypid = ...  -- NOT
       relevant; FSM states are CHECK constraint, not enum
    See terraform_lambda_drift_pattern.md memo for the
    -refresh=false -target pattern if you need to make terraform
    changes.

- For voice testing: the matika-voice-run.sh harness uses the
  Lekha (Hindi) / Samantha (English) / gTTS (Bengali) Mac voice
  pipeline. See voice_harness_lessons.md for the wedged-say-queue,
  Samsung-vs-Pixel logcat trigger, and DataStore language override
  patterns.

- The MatikaConversationViewModel's `startSession()` does
  `appSettings.language.first()` once per session — F22's Settings
  → Language picker is the user-facing way to pick language;
  caregivers tend to onboard in English, so en-IN is fine for the
  smoke unless you specifically want to test multilingual.

- Confirm with me before declaring Step 5 done — I want to see
  live-verification evidence (RDS rows + CloudWatch logs) before
  moving on.

Begin Step 4. Pick the smallest sub-task (4.1 or 4.6 — both
mechanical) first to confirm the build pipeline + FAB placement;
then 4.2 (sessionId threading) which is the most fiddly; then 4.4
(form modal); then 4.5 (escape hatch). Use the agentic Maestro
harness for Step 5 voice flow; use scripts/maestro-run.sh.
```

# Starting-state verification (run before coding)

Before you start Step 4, run these checks to confirm the backend state matches the kickoff's assumption. If any check fails, surface it before continuing — it means dev drifted between sessions.

| Check | Command | Expected |
|---|---|---|
| bedrock-router deployed | `aws lambda get-function --function-name matika-dev-bedrock-router --region ap-south-1 --query 'Configuration.LastModified'` | 2026-05-10 ~03:25Z (the F23 step-3 deploy) |
| create-patient-from-voice deployed | `aws lambda get-function --function-name carelog-dev-create-patient-from-voice --region ap-south-1 --query 'Configuration.State'` | `Active` |
| bedrock-router env wired | `aws lambda get-function --function-name matika-dev-bedrock-router --region ap-south-1 --query 'Configuration.Environment.Variables.CREATE_PATIENT_FROM_VOICE_FN_NAME'` | `carelog-dev-create-patient-from-voice` |
| V008 + V009 applied | `\d interaction_sessions` (via SSM tunnel) | `patient_id` is nullable; CHECK constraint accepts EXTRACTING_PROFILE etc. |
| New profile prompt deployed | unzip the deployed bedrock-router code OR `aws lambda invoke` with a placeholder caregiver_onboarding turn | turn returns a 200 with a `patientProfile` block, fsmState transitions through EXTRACTING_PROFILE |

If you want a fast sanity pre-flight, this synthetic invoke confirms the placeholder bootstrap path works end-to-end without any Android client:

```bash
# Generate a fresh session id; placeholder patientCognitoSub uses the
# pending-<sessionId> sentinel that bedrock-router treats specially.
SESSION_ID=$(uuidgen | tr 'A-Z' 'a-z')

# John CG's Cognito sub from jane_dev_test_account.md
CAREGIVER_SUB=2193bdfa-d001-70da-aa9a-395dabbe8122

cat > /tmp/f23_first_turn.json <<EOF
{
  "sessionId": "$SESSION_ID",
  "patientId": "pending-$SESSION_ID",
  "transcript": "I want to set up monitoring for my mother",
  "language": "en-IN",
  "turnSequence": 1,
  "sessionType": "caregiver_onboarding",
  "actorCognitoSub": "$CAREGIVER_SUB"
}
EOF

aws lambda invoke --function-name matika-dev-bedrock-router \
  --region ap-south-1 --cli-binary-format raw-in-base64-out \
  --payload file:///tmp/f23_first_turn.json /tmp/f23_response.json
cat /tmp/f23_response.json | python3 -m json.tool
```

You should see a 200 with `responseText` asking about the patient's name, `sessionState.fsmState` = `EXTRACTING_PROFILE`, and the bedrock-router's CloudWatch log showing the placeholder bootstrap path took. If the response shape doesn't match, the deploy or terraform state has drifted.

# Map of files Steps 1–3 touched (for context)

Backend:
- `backend/database/migrations/V008__interaction_sessions_nullable_patient_id.sql`
- `backend/database/migrations/V009__interaction_sessions_caregiver_onboarding_fsm_states.sql`
- `backend/lambdas/create-patient-from-voice/{index.js, package.json, package-lock.json}`
- `backend/lambdas/bedrock-router/src/{handler.ts, state_machine.ts, parser.ts, db.ts, index.ts, patient_from_voice.ts}`
- `backend/lambdas/bedrock-router/src/context/types.ts`
- `backend/lambdas/bedrock-router/output_schema.json`
- `backend/lambdas/bedrock-router/prompts/system_v2_caregiver_onboarding_profile.md`
- `backend/lambdas/bedrock-router/package.json` (added `@aws-sdk/client-lambda`)

Terraform:
- `infrastructure/terraform/modules/lambda/main.tf` (new lambda + SES grant)
- `infrastructure/terraform/modules/lambda/main_v2.tf` (bedrock-router env + IAM invoke grant)
- `infrastructure/terraform/modules/lambda/outputs.tf`

Docs (PRD/spec drafted before code; do NOT modify in Step 4 unless implementation surfaces a contradiction):
- `docs/matika_prd_v2.md` §6.3.1 / §8.1 / §6.5
- `docs/matika_spec_v2.md` §4.5 / §6.9
- `docs/testing_todos_v2.md` (F23 entry pending — currently not yet flipped to RESOLVED; flip when Step 5 verifies live)

# Files Step 4 will touch (best guess)

- `android/app/src/main/java/com/carelog/dashboard/ui/CaregiverHomeScreen.kt` — new secondary FAB
- `android/app/src/main/java/com/carelog/ui/CareLogNavHost.kt` — new route or extend existing PATIENT_ONBOARDING_CONVERSATION wiring
- `android/app/src/main/java/com/carelog/inference/MatikaConversationViewModel.kt` — accept external session id, hold patientCredentials, surface pause_session reason='awaiting_patient_credentials' as a UI state, force preferStreaming=false for caregiver_onboarding placeholder
- `android/app/src/main/java/com/carelog/inference/BedrockTurnClient.kt` — add `patientCredentials` to TurnRequest payload (one new optional field)
- A new `MatikaConversationScreen.kt` extension OR a new wrapper screen for the form modal + escape button. Probably easiest: extend `MatikaConversationScreen` with a `voiceOnboarding` parameter that toggles the additional UI bits.
- Optional: delete the orphan `PatientOnboardingConversationScreen.kt` + `CaregiverOnboardingViewModel.kt` + the unused MacMini API service deps they pull in.

# Open follow-ups beyond Step 5

- Streaming handler F23 pivot — flagged TODO in `handler.ts` line ~1497 comment. Currently Android client routes around it by forcing non-streaming for caregiver_onboarding.
- terraform import the manually-created API Gateway resources from F2 + F17 prior sessions (already noted in those F-numbers' testing_todos entries).
- Reminder UX redesign (F26 partially deferred) — needs product call on whether `frequency_days + daily_deadline` voice-set values should be editable on a screen, or remain voice-only.
- iOS-side voice patient onboarding — out of scope for v2.0 pilot per Android-focus directive.
