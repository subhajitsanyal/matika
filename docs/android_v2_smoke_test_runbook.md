# Android v2 — Smoke Test Runbook (Phase A.6)

**Goal:** verify the v2 patient-logging flow end-to-end in `en-IN`,
`hi-IN`, and `bn-IN` against the dev backend. Matches T-V2-140..142
exit criteria from `docs/matika_implementation_plan_v2.md`.

**Pre-requisites:** Phases A.1 → A.5 complete. `BuildConfig.API_BASE_URL`
points at the dev API Gateway. `BuildConfig.USE_V2_INFERENCE = true`.

---

## 0. Before you start

### 0.1 Pre-flight backend check (1 minute, anywhere with a shell)

```bash
curl -sS "https://rsf93ac8bd.execute-api.ap-south-1.amazonaws.com/dev/health"
```

Expected response (HTTP 200):

```json
{"status":"healthy","checks":{"rds":"up","bedrock":"up","bedrock_inference_region":"ap-south-1","s3":"up","lambda_warm":<bool>}, "timestamp":"..."}
```

If `status != "healthy"` or any check is `down`, fix the backend
before continuing — the app will fail in confusing ways otherwise.

### 0.2 Device prerequisites

- Android 9 (API 28) or newer (matches `minSdk = 28`).
- `RECORD_AUDIO` permission granted (the app prompts on first launch).
- Network connectivity (offline STT packs help latency but online STT
  works over Wi-Fi).
- **Recommended**: install the offline language packs for `en-IN`,
  `hi-IN`, `bn-IN` via Settings → System → Languages → Speech →
  Download offline data.
- **Recommended**: install TTS voice data for the same languages via
  Settings → System → Languages → Text-to-speech → Install voice data.
  Without voice data the app shows the response text on-screen but
  doesn't speak it — still acceptable for smoke testing.

### 0.3 Backend dev-data prerequisites for the test user

The v2 router Lambda resolves the Cognito sub to an internal
`patients.id` UUID via `PgUserResolver` (see Phase 0 gap #5). If the
test user doesn't have the right RDS rows the first `/turn` call
returns a "patient not found" error.

For the test user (let's call them `cognito-sub-X`), the dev RDS must have:

- One `users` row with `cognito_sub = cognito-sub-X`
- One `patients` row with `user_id` pointing at that users row
- At least one `parameter_configs` row for that patient defining a
  monitored parameter (e.g. `blood_pressure_systolic`)

If you've been running the existing v1 onboarding flow against dev,
these rows already exist. If you spun up a fresh user just for v2
testing, you may need to run the existing `invite-caregiver` /
`create-patient` Lambdas first, or manually seed via Flyway/psql
through the bastion.

### 0.4 Build + install the debug APK

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

To confirm `USE_V2_INFERENCE` actually routes to v2, the conversation
screen header should read **Matika — v2 (dev)** in the top bar. If
it reads "Conversation" or anything else, the flag wasn't picked up
— rebuild.

---

## 1. Per-language smoke test

Run the same 5-turn script in each of `en-IN`, `hi-IN`, `bn-IN`.
Switch language via Settings → Language inside the app between runs.

### 1.1 The 5-turn script

| Turn | Speak | Expected `extractedValues` | Expected response (gist) |
|---|---|---|---|
| 1 | (open) | — | Greeting in the chosen language |
| 2 | "BP is one thirty over eighty five" (or local equivalent) | `blood_pressure_systolic=130`, `blood_pressure_diastolic=85` | "I heard one thirty over eighty five. Is that correct?" — with `pending_confirmation` chips |
| 3 | "Yes that's correct" | Same values, `status=confirmed` | Acknowledgement + ask for next parameter |
| 4 | "Sugar is one forty two" (or local) | `blood_glucose=142` | "I heard one forty two. Is that correct?" |
| 5 | "Yes" | Same value, `status=confirmed` | "Thank you, that's everything" + `complete_session` action — screen should navigate to summary |

#### English utterances

- BP: "BP is one thirty over eighty five" or "My blood pressure is 130 over 85"
- Sugar: "Sugar is one forty two" or "My blood sugar is 142"

#### Hindi utterances

- BP: "बीपी एक सौ तीस बटा पच्चासी है" / "ब्लड प्रेशर एक तीस ऊपर पच्चासी"
- Sugar: "शुगर एक सौ बयालीस है" / "मेरा शुगर 142 है"

#### Bengali utterances

- BP: "বিপি একশো ত্রিশ বাই পঁচাশি" / "ব্লাড প্রেসার ১৩০ ওভার ৮৫"
- Sugar: "সুগার একশো বিয়াল্লিশ" / "আমার সুগার ১৪২"

### 1.2 What to watch on the screen

- **FSM badge**: starts `CREATED`, transitions to `EXTRACTING` /
  `PENDING_CONFIRMATION` / `COMPLETE`. An `UNKNOWN` badge means the
  server returned an FSM state the client doesn't model — file as a
  follow-up, not a blocker.
- **Turn counter** in the top-right increments by 1 per submitted turn.
- **"thinking…" / "speaking…" / "listening…"** indicators — should
  flow naturally without overlap.
- **Pending values cards** appear after turn 2 with the BP values.
  Status chip should read "pending"; after turn 3 it should read
  "confirmed" (or the values move from `pendingConfirmation` into
  `capturedThisSession` — server-driven).
- **Still needed chips** should shrink as parameters are confirmed.

### 1.3 What to watch in CloudWatch

Open the bedrock-router Lambda log group
(`/aws/lambda/matika-dev-bedrock-router`) and watch for:

- One log line per turn with `tier`, `model`, `latencyMs`,
  `cachedInputTokens`. Cached tokens > 1000 after turn 2 confirms the
  prompt cache is working.
- `parse_recovered_bare_json` warnings — possible but not fatal; the
  lenient parser fallback recovered. File as a prompt-tuning follow-up.
- Any `ERROR`-level log: read the stack and stop the smoke test until
  resolved.

---

## 2. Pass / fail criteria

**Pass** for a language run if:
- All 5 turns complete without the app showing an error snackbar.
- Turn 2 produces both BP values with status `pending_confirmation`.
- Turn 3 transitions them to `confirmed`.
- Turn 5 emits `complete_session` and the screen navigates to summary.
- Turn-to-turn latency P95 is under 2 seconds (rough — count seconds
  between speech-end and response-start).

**Fail** if any of:
- Turn 2 returns no `extractedValues` (extraction broke).
- Turn 3 doesn't change status to `confirmed` (confirmation flow broken).
- App shows a 4xx/5xx error snackbar (backend rejection or app misbuild).
- TTS speaks nonsense ("130 slash 85" — `NumberFormatter` regression).

---

## 3. Failure-mode cheat sheet

| Symptom | Likely cause | First check |
|---|---|---|
| Snackbar "Not signed in" on screen entry | `AuthRepository.getCurrentUser()` returned null | Re-login through the existing v1 flow |
| Snackbar "STT PERMISSION_DENIED" | `RECORD_AUDIO` not granted | Settings → Apps → CareLog → Permissions |
| Snackbar "STT UNAVAILABLE" | No speech recognition service | Check Google app version; recent OS upgrade can disable |
| Snackbar "STT NO_MATCH" | Speech wasn't recognised | Speak louder / re-articulate; confirm offline pack matches the chosen language |
| Snackbar "STT NETWORK" | Online STT fallback couldn't reach the network | Check Wi-Fi/data; install the offline pack |
| Snackbar with "internal_error" / "503" | Backend issue | CloudWatch `bedrock-router` logs |
| Snackbar with "patient not found" / "user not linked" | RDS dev data missing for the test user | See §0.3 above |
| App is silent (no TTS) but text shows | TTS voice data not installed | Settings → System → Languages → Text-to-speech → Install voice data |
| FSM badge stuck at `UNKNOWN` | Server returned an FSM state we don't model | File a follow-up; not a blocker — the rest of the flow still works |
| Turns succeed but `cachedInputTokens` is 0 every turn | Prompt cache is missing | Backend follow-up, not an Android issue |
| Top bar reads "Conversation" not "Matika — v2 (dev)" | Flag fell back to v1 | Confirm `BuildConfig.USE_V2_INFERENCE = true` and rebuild |

---

## 4. Reporting back

After running all three languages, paste a short summary into
`docs/android_v2_plan.md` Status log. Format:

```
| 2026-05-DD | A.6 | Smoke en/hi/bn against dev — pass/fail per language, P95 turn latency observed, anything weird worth a follow-up. |
```

Open follow-up tickets for any non-blocker issues — don't block
Phase B on prompt-tuning concerns.
