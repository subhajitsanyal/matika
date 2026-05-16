# Runbook — Android app against the staging backend

**When to use this:** during the staging soak window (currently
2026-05-15 → ~2026-05-22). Lets the Android app on a test device
talk to the staging AWS stack instead of dev so the soak's
CloudWatch alarms see real traffic patterns rather than staying
`INSUFFICIENT_DATA` for the whole week.

**Related:**
- `docs/setup-and-deployment-guide.md` §"Staging environment
  stand-up" — how staging was built.
- `docs/launch-execution-5-kickoff.md` — session-level context.
- Memory: `v2_open_blockers_endofday_20260515.md`.

---

## Why a rebuild is needed

`android/app/build.gradle.kts:42` bakes the dev API GW invoke URL
into `BuildConfig.API_BASE_URL` at compile time for the debug
variant. The release variant has a placeholder that doesn't work.
There is no runtime env switch — switching target environment
requires rewriting `build.gradle.kts`, rebuilding, and reinstalling.

The two debug+release variants share `applicationId = com.carelog`,
so dev + staging APKs cannot coexist on the same device. Uninstall
before reinstalling the other.

---

## Prereqs

### 1. SES verified identity for every recipient

SES is in sandbox in `ap-south-1` (`ProductionAccessEnabled: false`,
200 msg/day cap). Every `To:` address must be an SES-verified
identity or the email never leaves AWS. Applies to:

- Cognito sign-up OTP / FORCE_CHANGE_PASSWORD / password-reset
- `invite-attendant` / `invite-doctor` welcome emails
- `create-patient-from-voice` welcome email

**Check who's already verified:**

```bash
aws sesv2 list-email-identities --region ap-south-1 \
  --query 'EmailIdentities[].IdentityName' --output text \
  | tr '\t' '\n' | sort
```

Then per address (the list-view `VerifiedForSendingStatus` field is
misleading — it only populates fully on domain identities):

```bash
aws sesv2 get-email-identity \
  --email-identity <addr> \
  --region ap-south-1 \
  --query 'VerifiedForSendingStatus' --output text
# True = verified, false / absent = needs the click-the-link step
```

**Add a new recipient:**

```bash
aws sesv2 create-email-identity \
  --email-identity <participant@example.com> \
  --region ap-south-1
```

AWS emails the recipient an `Amazon SES Address Verification Request
in region Asia Pacific (Mumbai)` message from
`no-reply-aws@amazon.com`. Recipient clicks the link (expires in
24h) and the API flips `VerifiedForSendingStatus` to `True`.

**Gmail `+aliases` are separate SES identities.** SES treats
`sanyalsubhajit2010+staging@gmail.com` as distinct from
`sanyalsubhajit2010@gmail.com`. Both deliver to the same inbox but
each needs its own verification step.

### 2. AWS CLI auth + region

```bash
aws sts get-caller-identity   # confirm account 316643066568
aws configure get region      # should be ap-south-1 or pass --region everywhere
```

### 3. SSM session-manager plugin

Already installed if you've used `aws ssm start-session` before.

---

## Switch the APK to staging

```bash
# Rewrites:
#   android/app/build.gradle.kts debug-variant buildConfigField
#   android/app/src/main/res/raw/amplifyconfiguration.json
#     (Cognito pool/client/region, S3 bucket name)
scripts/update-app-config.sh staging
```

The script looks up live AWS state by env-name (API GW named
`carelog-staging-api`, Cognito pool `carelog-staging-users`, S3
bucket matching `carelog*staging*documents`). After it runs,
git-diff should show only the URL/ID swaps; no other lines.

```bash
adb uninstall com.carelog   # if a dev APK is installed
cd android
./gradlew assembleDebug
./gradlew installDebug
# or: adb install app/build/outputs/apk/debug/app-debug.apk
```

Verify on the device: launch the app, force-stop and re-open,
then `adb logcat | grep -E "API_BASE_URL|matika_response"` and you
should see the staging GW host (`3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging`)
in the first request.

---

## What works on staging today

- Cold-start, login screen, UI rendering
- Caregiver self-registration (email-verify + form OR voice)
- Voice patient onboarding (CG-V2-03 / F23) — caregiver_onboarding
  session writes `parameter_configs` cleanly via `protocol_persister`
- `/health` endpoint, all read endpoints that don't require a
  specific known user

## What does NOT work on staging

- **Anything that assumes Jane Doe / John CG.** Their UUIDs and
  Cognito subs are dev-only; staging RDS has zero seeded users.
  Affected: every CG-V2-07/08/09 push test, CG-V2-12 thresholds,
  CG-V2-17 trends, every threshold-breach E2E.
- **Push notifications until first login.** FCM device-token
  registers on login, not at install time.
- **`~/.matika-test-creds.env` as currently set** — those creds
  are dev. Either swap to staging creds in the same file or
  maintain a parallel `.matika-test-creds-staging.env`.
- **Existing Maestro flows that hardcode patient short-id
  `CL-63NRGO`** (Jane) — they'll error at the patient-card lookup.

---

## Minimum-viable soak traffic recipe (~30 min)

Make the staging alarms see actual traffic instead of staying
`INSUFFICIENT_DATA`:

1. Confirm a verified address you'll use as caregiver (e.g.
   `sanyalsubhajit2010@gmail.com` — already verified in the
   identities list).
2. `scripts/update-app-config.sh staging && cd android && \
   ./gradlew assembleDebug installDebug`.
3. App: sign up as that caregiver. Click the Cognito OTP from the
   inbox. Set first-time password.
4. Add a synthetic patient via the form-based "Add Patient" FAB
   (faster than voice for this step). Use another verified address
   (or `+pt` alias that you create + verify first) as the patient
   email so the welcome email lands.
5. Open the protocol-config conversation that auto-launches after
   patient create. Drive ONE turn via text fallback:
   `"I want to track her blood pressure every morning, fasting
   blood sugar twice a week, and her weight on Sundays."` This
   exercises `bedrock-router` + `parameter_configs` UPSERT +
   `model_call` telemetry + `interaction_sessions` row.
6. Optional: log one or two vitals via voice or text fallback
   from the patient login. Wait ~1 minute and the
   `evaluate-thresholds-batch` cron picks them up.
7. Wait 5-10 minutes and check that the relevant alarms have
   moved from `INSUFFICIENT_DATA` to `OK`:

```bash
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix carelog-staging \
  --query 'MetricAlarms[?StateValue==`INSUFFICIENT_DATA`].AlarmName' \
  --output text | tr '\t' '\n' | sort
```

Each invoked lambda's `lambda_error_rate` alarm should disappear
from that list. The cron-scheduled rollups (vital_coverage,
conversation_session, alert_flow, patient_engagement,
cost_telemetry) move on their own schedule regardless.

---

## Check the soak state any time

```bash
# Any alarms firing?
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix carelog-staging \
  --query 'MetricAlarms[?StateValue==`ALARM`].[AlarmName,StateReason]' \
  --output table
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix matika-staging \
  --query 'MetricAlarms[?StateValue==`ALARM`].[AlarmName,StateReason]' \
  --output table

# Distribution
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix carelog-staging \
  --query 'MetricAlarms[].StateValue' --output text \
  | tr '\t' '\n' | sort | uniq -c
```

If any Critical alarm fires: fix on dev first, re-apply to
staging, **restart the 7-day clock** (memory update).

---

## Going back to dev

```bash
scripts/update-app-config.sh dev   # or omit arg; "dev" is the default
adb uninstall com.carelog
cd android && ./gradlew assembleDebug installDebug
```

Sanity-check via logcat that the request host is back to
`rsf93ac8bd.execute-api.ap-south-1.amazonaws.com/dev`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-up appears to succeed but no OTP email arrives | Recipient address is not in SES verified identities | `aws sesv2 create-email-identity --email-identity <addr> --region ap-south-1`; recipient clicks link |
| `update-app-config.sh staging` fails with "no API GW found" | Wrong AWS profile / wrong region | `aws sts get-caller-identity` should show account `316643066568`; pass `--region ap-south-1` |
| `./gradlew installDebug` errors `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Existing APK on device targets dev with a different signing key state | `adb uninstall com.carelog` first |
| App opens but every screen shows "Network error" | Backed onto a stale Cognito pool ID after the env switch | Re-run `scripts/update-app-config.sh staging`; verify `amplifyconfiguration.json` got rewritten (check the file's git-diff) |
| Voice protocol session never completes | Bedrock model-access not approved in this account/region | Should be fine in ap-south-1; verify with the dev /health endpoint's `bedrock: up` indicator |
