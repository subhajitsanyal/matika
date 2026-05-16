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

## Staging environment quick reference

Pin this somewhere handy; the rest of the runbook assumes these
values.

| Resource | Value |
|---|---|
| AWS account | `316643066568` |
| Region | `ap-south-1` |
| API GW invoke URL | `https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging` |
| API GW REST API ID | `3mni7nx5bf` |
| Cognito user pool name | `carelog-staging-users` |
| Bastion EC2 instance | `i-0f2acdf1a96ee24a6` |
| RDS endpoint | `carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com:5432` |
| RDS DB name | `carelog_staging` |
| RDS admin user | `carelog_staging_admin` |
| DB password Secrets Manager id | `carelog-staging-db-password` |
| Local tunnel port (staging) | `55433` (dev uses 55432; prod will use 55434) |
| SES configuration set | `matika-staging-default` |
| SES events SNS topic | `arn:aws:sns:ap-south-1:316643066568:matika-staging-ses-events` |
| Operator alerts SNS topic | `arn:aws:sns:ap-south-1:316643066568:carelog-staging-operator-alerts` |
| CloudWatch dashboard | `carelog-staging` |

Quick connectivity smoke (run any time):

```bash
curl -sS -w "\nHTTP_CODE=%{http_code}\n" \
  https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging/health
# Expect HTTP_CODE=200 with
# {"status":"healthy","checks":{"rds":"up","bedrock":"up","s3":"up","lambda_warm":true/false}}
```

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
200 msg/day cap, 1 msg/sec). Every `To:` address must be an
SES-verified identity or the email never leaves AWS. Applies to:

- Cognito sign-up OTP / FORCE_CHANGE_PASSWORD / password-reset
- `invite-attendant` / `invite-doctor` welcome emails
- `create-patient-from-voice` welcome email

**Check current sandbox state + sending quota:**

```bash
aws sesv2 get-account --region ap-south-1 \
  --query '{ProductionAccess:ProductionAccessEnabled,
            SendingEnabled:SendingEnabled,
            MaxSendRate:SendQuota.MaxSendRate,
            Max24Hour:SendQuota.Max24HourSend,
            Sent24Hr:SendQuota.SentLast24Hours}'
# Expect: ProductionAccess=false, SendingEnabled=true,
# MaxSendRate=1.0, Max24Hour=200, Sent24Hr=<small int>
```

**List who's already a registered identity:**

```bash
aws sesv2 list-email-identities --region ap-south-1 \
  --query 'EmailIdentities[].[IdentityType,IdentityName]' \
  --output table
```

Registration is *not* the same as verification — registration just
adds the address to SES; verification requires the recipient to
click the link AWS emails them. The list-view's
`VerifiedForSendingStatus` field is misleading (only populates fully
on domain identities), so always check per-identity:

```bash
# Check one address
aws sesv2 get-email-identity \
  --email-identity <addr> \
  --region ap-south-1 \
  --query 'VerifiedForSendingStatus' --output text
# True = verified, False = registered-but-link-not-clicked

# Or sweep a list:
for id in subhajit.sanyal@gmail.com sanyalsubhajit2010@gmail.com \
          subhajit.sanyal+attendant@gmail.com \
          sanyalsubhajit2010+pt@gmail.com subhajit@kyabla.in; do
  printf '%-44s ' "$id"
  aws sesv2 get-email-identity --email-identity "$id" --region ap-south-1 \
    --query 'VerifiedForSendingStatus' --output text
done
```

**Add a new recipient (one-off):**

```bash
aws sesv2 create-email-identity \
  --email-identity participant@example.com \
  --region ap-south-1
# Response shape: { "IdentityType": "EMAIL_ADDRESS",
#                   "VerifiedForSendingStatus": false }
```

AWS immediately emails the address an
`Amazon SES Address Verification Request in region Asia Pacific
(Mumbai)` message from `no-reply-aws@amazon.com`. Recipient clicks
the embedded `ses-manage-confirmation` link (expires in 24h),
sees an AWS-hosted "Congratulations" page, and the API flips
`VerifiedForSendingStatus` to `True`. Re-run the per-identity check
to confirm.

**Add many at once (beta coordinator helper):**

```bash
# Save as scripts/beta-onboard-recipient.sh
for email in "$@"; do
  aws sesv2 create-email-identity --email-identity "$email" --region ap-south-1
  echo "Registered $email — tell them to check inbox for AWS verification link"
done
```

**Gmail `+aliases` are separate SES identities.** SES treats
`sanyalsubhajit2010+staging@gmail.com` as distinct from
`sanyalsubhajit2010@gmail.com`. Both deliver to the same inbox but
each needs its own `create-email-identity` + click-the-link step.

### 2. AWS CLI auth + region

```bash
aws sts get-caller-identity
# Expect: "Account": "316643066568", "Arn": "...:user/matika-admin" or similar
aws configure get region
# Should be ap-south-1 or pass --region ap-south-1 to every command
```

### 3. SSM session-manager plugin (for SSM tunnel to RDS)

```bash
# macOS: install via Homebrew if not present
which session-manager-plugin || \
  brew install --cask session-manager-plugin

# Sanity check
session-manager-plugin
# Expect: "The Session Manager plugin was installed successfully. ..."
```

### 4. Connected Android device (or emulator)

```bash
adb devices
# Expect at least one device line ending in "device" (not "unauthorized")
# Example: RFCT10C1GSZ        device
```

### 5. libpq psql (for RDS verification)

Homebrew installs at `/opt/homebrew/opt/libpq/bin/psql` — the system
`psql` from Homebrew's `pg_dump` package isn't linked against the
right libpq for this version.

```bash
ls /opt/homebrew/opt/libpq/bin/psql || brew install libpq
```

---

## Switch the APK to staging

```bash
cd /Users/subhajitsanyal/Work/Projects/Matika/appdevel/matika
scripts/update-app-config.sh staging
```

What this rewrites:

| File | Field |
|---|---|
| `android/app/build.gradle.kts` | debug-variant `buildConfigField("String", "API_BASE_URL", "...")` |
| `android/app/src/main/res/raw/amplifyconfiguration.json` | `CognitoUserPool.Default.PoolId / AppClientId / Region` + `Auth.Default.OAuth.WebDomain / AppClientId` |

The script also tries to update `storage.plugins.awsS3StoragePlugin.bucket`
if present — but Matika's amplifyconfiguration.json has no S3 block
(the app uses S3 via the `presigned-url` lambda + direct uploads,
not the Amplify Storage plugin), so that update is a silent no-op.
A clean diff shows only the 5 Cognito/OAuth values + the
`API_BASE_URL` line; no S3 line is expected.

The script looks up live AWS state by env-name (API GW named
`carelog-staging-api`, Cognito pool `carelog-staging-users`, S3
bucket matching `carelog*staging*documents`). Expected console
output:

```
=== Fetching infrastructure config for 'staging' from AWS (ap-south-1) ===
API Gateway URL: https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging
Cognito Pool: ap-south-1_XXXX  Client: XXXX
S3 Bucket: carelog-v2-staging-documents-...
Updating Android build.gradle.kts debug API_BASE_URL...
Updating Android amplifyconfiguration.json...
=== Done ===
```

After it runs, verify only the URL/ID swaps changed and nothing
else:

```bash
git diff android/app/build.gradle.kts \
         android/app/src/main/res/raw/amplifyconfiguration.json
# Should show only the API_BASE_URL line + the Cognito pool/client/region +
# S3 bucket name changing. If any other field moves, stop — investigate
# before continuing.
```

Rebuild + reinstall:

```bash
adb uninstall com.carelog   # if a dev APK is installed; expect "Success"
                            # or "Failure [DELETE_FAILED_INTERNAL_ERROR]"
                            # which means the package wasn't installed (OK)

cd android
./gradlew assembleDebug --console=plain 2>&1 | tail -10
# Expect: "BUILD SUCCESSFUL in <N>s"; warnings are fine but no errors.

./gradlew installDebug --console=plain 2>&1 | tail -5
# Or: adb install -r app/build/outputs/apk/debug/app-debug.apk
# Expect: "Installed on <N> device" or adb: "Success"
```

Verify the app is actually talking to staging:

```bash
adb logcat -c   # clear buffer
adb shell am force-stop com.carelog
adb shell monkey -p com.carelog -c android.intent.category.LAUNCHER 1
sleep 5
adb logcat -d | grep -E "3mni7nx5bf|API_BASE_URL|staging"
# Expect at least one line referencing
# 3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging
```

If you see `rsf93ac8bd.execute-api.ap-south-1.amazonaws.com/dev`
instead, the install didn't take — re-uninstall and re-install.

---

## What works on staging today

- Cold-start, login screen, UI rendering
- Caregiver self-registration via email + voice/form (provided the
  caregiver's email is SES-verified)
- Voice patient onboarding (CG-V2-03 / F23) — caregiver_onboarding
  session writes `parameter_configs` cleanly via `protocol_persister`
- `/health` endpoint, all read endpoints that don't require a
  specific known user
- SES bounce/complaint pipeline (task #23) — sends from the 4
  email-sending lambdas route through `matika-staging-default`
  configuration set; bounces fan out to
  `matika-staging-ses-events` SNS topic and into
  `email_suppression` table

## What does NOT work on staging

- **Anything that assumes Jane Doe / John CG.** Their UUIDs and
  Cognito subs are dev-only; staging RDS has zero seeded users.
  Affected: every CG-V2-07/08/09 push test, CG-V2-12 thresholds,
  CG-V2-17 trends, every threshold-breach E2E that depends on
  Jane's BP parameter_configs.
- **Push notifications until first login.** FCM device-token
  registers on first login, not at install time. So the first
  successful login on staging is also the "register the device"
  step.
- **`~/.matika-test-creds.env` as currently set** — those credentials
  are for dev Cognito. Either swap to staging creds in the same
  file or maintain a parallel `~/.matika-test-creds-staging.env`.
- **Existing Maestro flows that hardcode patient short-id
  `CL-63NRGO`** (Jane) — they'll error at the patient-card lookup.
  Either seed an equivalent test pair in staging (see "Optional —
  seed a fixed test pair" below) or skip those flows.

---

## Minimum-viable soak traffic recipe (~30 min)

This walks through making the staging alarms move from
`INSUFFICIENT_DATA` to `OK` by exercising the major code paths
once each.

### 0. Pick a verified caregiver address

You can use any verified address. For a clean test run with no
historical state, use a `+staging` alias of one of your verified
gmail accounts. Verify it first:

```bash
# Register the alias (if not already)
aws sesv2 create-email-identity \
  --email-identity sanyalsubhajit2010+staging-cg@gmail.com \
  --region ap-south-1

# Wait for AWS email, click verification link, then confirm:
aws sesv2 get-email-identity \
  --email-identity sanyalsubhajit2010+staging-cg@gmail.com \
  --region ap-south-1 \
  --query 'VerifiedForSendingStatus' --output text
# Expect: True
```

### 1. Switch + reinstall the APK

```bash
cd /Users/subhajitsanyal/Work/Projects/Matika/appdevel/matika
scripts/update-app-config.sh staging
adb uninstall com.carelog
cd android && ./gradlew assembleDebug installDebug --console=plain
```

### 2. Sign up as the caregiver

In the app:
1. Tap "Register" on the login screen.
2. Enter the verified caregiver email (`sanyalsubhajit2010+staging-cg@gmail.com`),
   a password, name.
3. Submit. Cognito sends an OTP to the verified inbox.
4. Enter the OTP in the verification screen.

This lambda chain fires:
- `post-confirmation` (Cognito trigger → INSERT into `users` table)
- `consent` GET (initial consent screen needs the policy hash)
- `consent` POST after user accepts the cross-region disclosure

### 3. Voice-onboard a patient

You need ANOTHER verified address for the patient's login email
(since the welcome email needs to deliver):

```bash
aws sesv2 create-email-identity \
  --email-identity sanyalsubhajit2010+staging-pt@gmail.com \
  --region ap-south-1
# Click link in inbox.
```

In the app (still logged in as the caregiver):
1. Tap the "Add Patient via Conversation" FAB (the mic-icon button).
2. The app mints a fresh `sessionId` and opens the voice
   conversation screen.
3. Speak the patient's profile to the prompt (name, age, language,
   conditions). Example: "I want to add Asha Devi, she's 72 years
   old, lives in Bengaluru, speaks Hindi and English, has Type 2
   diabetes and hypertension."
4. Confirm the extracted profile when prompted.
5. When asked for patient credentials, provide the email
   `sanyalsubhajit2010+staging-pt@gmail.com`.
6. The session pivots: `create-patient-from-voice` lambda fires,
   creates the Cognito user + RDS row, emails the welcome message,
   and the session continues into protocol-extraction.
7. Continue the conversation: "track her blood pressure every
   morning at 8 AM, fasting blood sugar twice a week on Mondays
   and Thursdays, and weight on Sundays." The session ends with
   the Sonnet protocol-extraction pass writing `parameter_configs`
   for systolic + diastolic BP + glucose + weight.

This exercises the heaviest staging chain in one go:
- `bedrock-router` (multiple Haiku + Sonnet calls)
- `bedrock-vision` if any photo step
- `create-patient-from-voice`
- `post-confirmation`
- `consent`
- `protocol_persister` UPSERT to `parameter_configs`
- `interaction_sessions` writes
- `model_call` telemetry rows
- FHIR observations bridge if any vitals are mentioned

### 4. Verify the writes landed in staging RDS

Open the SSM tunnel (staging port is 55433 — different from dev's
55432 so both can run simultaneously):

```bash
# Detached so the parent shell can run psql afterwards
nohup aws ssm start-session \
  --target i-0f2acdf1a96ee24a6 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com"],
                 "portNumber":["5432"],
                 "localPortNumber":["55433"]}' \
  --region ap-south-1 > /tmp/ssm-staging.log 2>&1 &
disown $! 2>/dev/null

# Wait for "Waiting for connections" before issuing psql commands
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  grep -q "Waiting for connections" /tmp/ssm-staging.log && \
    { echo "tunnel up"; break; }
done

# Connect (each psql uses inline PGPASSWORD — see dev_rds_ssm_tunnel.md
# pattern). Each command stands alone so variable word-splitting
# isn't an issue.
PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id carelog-staging-db-password --region ap-south-1 \
  --query SecretString --output text \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])") \
  /opt/homebrew/opt/libpq/bin/psql \
  -h 127.0.0.1 -p 55433 -U carelog_staging_admin -d carelog_staging \
  -c "SELECT u.email, u.persona_type, u.created_at,
             p.patient_id, p.first_name, p.last_name
      FROM users u
      LEFT JOIN patients p ON p.user_id = u.id
      WHERE u.email LIKE 'sanyalsubhajit2010+staging%'
      ORDER BY u.created_at;"
# Expect: 2 rows (one caregiver with persona_type='caregiver', one
# patient with the patient_id like CL-XXXXXX)

PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id carelog-staging-db-password --region ap-south-1 \
  --query SecretString --output text \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])") \
  /opt/homebrew/opt/libpq/bin/psql \
  -h 127.0.0.1 -p 55433 -U carelog_staging_admin -d carelog_staging \
  -c "SELECT patient_id, parameter_name, frequency_days,
             daily_deadline, timezone, threshold_min, threshold_max
      FROM parameter_configs
      WHERE patient_id IN (SELECT id FROM patients
                           WHERE user_id IN (SELECT id FROM users
                                              WHERE email LIKE 'sanyalsubhajit2010+staging%'))
      ORDER BY parameter_name;"
# Expect: 4+ rows for BP systolic + diastolic + glucose + weight,
# with frequency_days populated (1 for daily, 7 for weekly,
# 3 or 4 for biweekly, etc.)

PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id carelog-staging-db-password --region ap-south-1 \
  --query SecretString --output text \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])") \
  /opt/homebrew/opt/libpq/bin/psql \
  -h 127.0.0.1 -p 55433 -U carelog_staging_admin -d carelog_staging \
  -c "SELECT session_type, status, started_at, ended_at,
             (transcript_history IS NOT NULL) AS has_transcript
      FROM interaction_sessions
      ORDER BY started_at DESC LIMIT 5;"
# Expect: latest row is session_type='caregiver_onboarding',
# status='complete', ended_at not null, has_transcript=true

# Tunnel cleanup when done
pkill -f "ssm start-session" 2>/dev/null
rm -f /tmp/ssm-staging.log
unset PGPASSWORD   # belt-and-suspenders
```

### 5. Optional: log a vital, trigger a threshold breach

Log out of caregiver, log in as the patient (with the
temporary password from the welcome email), and either:

**Text fallback:** start a conversation, type "my blood pressure
is 165 over 105 this morning" (intentionally above the 160/95
threshold the caregiver set). The session writes a FHIR Observation
to S3 + an `alerts` row.

**Voice:** tap the mic icon and speak the same utterance. Same
result if STT picks it up correctly.

Within ~1 minute the `evaluate-thresholds-batch` lambda fires (per
its EventBridge cron) and emits an alert. Verify:

```bash
# Re-open tunnel as in step 4, then:
PGPASSWORD=...PSQL... \
  -c "SELECT a.id, a.alert_type, a.vital_value, a.vital_unit,
             a.threshold_min, a.threshold_max, a.is_sent, a.sent_at
      FROM alerts a
      WHERE a.created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY a.created_at DESC LIMIT 5;"
# Expect: alert_type='threshold_breach', vital_value=165 (or whatever
# you logged), is_sent=true (notification-sender already published
# to SNS Platform App), threshold_max=160.
```

### 6. Check that alarms moved off INSUFFICIENT_DATA

Wait ~5 minutes after the activity (CloudWatch metrics emit on a
1-minute cadence but alarms evaluate over 5-minute windows). Then:

```bash
# How many alarms are still INSUFFICIENT_DATA?
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix carelog-staging \
  --query 'length(MetricAlarms[?StateValue==`INSUFFICIENT_DATA`])'

# Which ones specifically?
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix carelog-staging \
  --query 'MetricAlarms[?StateValue==`INSUFFICIENT_DATA`].AlarmName' \
  --output text | tr '\t' '\n' | sort

# Same for matika-staging-prefix (v2 lambdas)
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix matika-staging \
  --query 'MetricAlarms[?StateValue==`INSUFFICIENT_DATA`].AlarmName' \
  --output text | tr '\t' '\n' | sort
```

Each invoked lambda's `lambda_error_rate` alarm should disappear
from that list and show up in OK. The cron-scheduled rollups
(`vital_coverage_rollup`, `conversation_session_rollup`,
`alert_flow_rollup`, `patient_engagement_rollup`,
`cost_telemetry_rollup`) move on their own hourly/daily schedule
regardless of test traffic.

### 7. Check the lambda CloudWatch logs

If anything didn't write what you expected, log groups are at:

```bash
# Pick a lambda name from your test (e.g. create-patient-from-voice)
aws logs filter-log-events \
  --log-group-name "/aws/lambda/carelog-staging-create-patient-from-voice" \
  --start-time $(($(date -u +%s)*1000 - 600000)) \
  --region ap-south-1 \
  --query 'events[].message' --output text

# For v2-prefix lambdas
aws logs filter-log-events \
  --log-group-name "/aws/lambda/matika-staging-bedrock-router" \
  --start-time $(($(date -u +%s)*1000 - 600000)) \
  --region ap-south-1 \
  --filter-pattern "caregiver_onboarding pivot ok" \
  --query 'events[].message' --output text
```

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

# Distribution across all staging alarms
for prefix in carelog-staging matika-staging; do
  echo "=== $prefix ==="
  aws cloudwatch describe-alarms --region ap-south-1 \
    --alarm-name-prefix "$prefix" \
    --query 'MetricAlarms[].StateValue' --output text \
    | tr '\t' '\n' | sort | uniq -c
done

# Recent alarm-state-change history (the SNS topic also emails you these,
# but the CLI is faster for spot-checks)
aws cloudwatch describe-alarm-history --region ap-south-1 \
  --history-item-type StateUpdate \
  --start-date $(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ) \
  --query 'AlarmHistoryItems[?contains(AlarmName, `staging`)].[Timestamp,AlarmName,HistorySummary]' \
  --output table | head -30
```

**Inbox check for soak alarm emails:** confirmed subscriber is
`subhajit@kyabla.in`. Subject lines look like
`ALARM: "carelog-staging-..." in Asia Pacific (Mumbai)`. If you
weren't getting these, re-check the subscription state:

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:ap-south-1:316643066568:carelog-staging-operator-alerts \
  --region ap-south-1 \
  --query 'Subscriptions[].[Endpoint,Protocol,SubscriptionArn]' \
  --output table
# Endpoint should show subhajit@kyabla.in with a real ARN, NOT
# "PendingConfirmation"
```

**If any Critical alarm fires:** investigate root cause, fix on
dev first, re-apply to staging, **restart the 7-day soak clock**
(memory update — rename `v2_open_blockers_endofday_YYYYMMDD.md`
to the new day's date).

---

## Optional — seed a fixed test pair in staging (Jane-clone)

If you want the existing Maestro flows to work against staging
without re-authoring, seed an equivalent pair in staging RDS.
Mirror the dev pattern from `jane_dev_test_account.md` but with
new UUIDs / Cognito subs.

Step 1 — create the Cognito users via admin API (NOT via the app —
admin-create-user bypasses the verification email so we don't have
to play the SES dance for these synthetic accounts):

```bash
STAGING_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 \
  --region ap-south-1 \
  --query "UserPools[?Name=='carelog-staging-users'].Id" --output text)
echo "Pool: $STAGING_POOL_ID"

# Caregiver
aws cognito-idp admin-create-user --user-pool-id "$STAGING_POOL_ID" \
  --username staging-jane-cg@matika.test \
  --user-attributes \
      Name=email,Value=staging-jane-cg@matika.test \
      Name=email_verified,Value=true \
      Name=name,Value="Staging John CG" \
      Name=custom:persona_type,Value=caregiver \
  --message-action SUPPRESS \
  --region ap-south-1

aws cognito-idp admin-set-user-password --user-pool-id "$STAGING_POOL_ID" \
  --username staging-jane-cg@matika.test \
  --password 'YourStrongPass1!' --permanent --region ap-south-1

aws cognito-idp admin-add-user-to-group --user-pool-id "$STAGING_POOL_ID" \
  --username staging-jane-cg@matika.test \
  --group-name relatives --region ap-south-1

# Repeat for the patient (Jane-clone)
```

Step 2 — RDS rows + persona_links + parameter_configs (open tunnel
as in step 4 above, then run the equivalent INSERT block from
`jane_dev_test_account.md` adjusted to the new UUIDs / Cognito subs
captured from step 1).

Step 3 — save the staging Cognito subs + RDS UUIDs to a new memory
file (`jane_staging_test_account.md`) so future sessions don't have
to re-derive them.

**Recommendation:** only do this if you intend to run the Maestro
suite against staging more than once. For a single soak-traffic
recipe, the live caregiver+patient sign-up flow is faster.

---

## Going back to dev

```bash
cd /Users/subhajitsanyal/Work/Projects/Matika/appdevel/matika
scripts/update-app-config.sh dev   # or omit arg; "dev" is the default

adb uninstall com.carelog
cd android && ./gradlew assembleDebug installDebug --console=plain

# Sanity-check the env switch landed
adb logcat -c
adb shell am force-stop com.carelog
adb shell monkey -p com.carelog -c android.intent.category.LAUNCHER 1
sleep 5
adb logcat -d | grep -E "rsf93ac8bd|API_BASE_URL"
# Expect lines referencing rsf93ac8bd.execute-api.ap-south-1.amazonaws.com/dev
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-up appears to succeed but no OTP email arrives | Recipient address is not SES-verified | `aws sesv2 create-email-identity --email-identity <addr> --region ap-south-1`; recipient clicks the AWS verification link |
| `update-app-config.sh staging` fails with "no API GW found" or empty `API_BASE_URL` | Wrong AWS profile / wrong region / staging not applied | `aws sts get-caller-identity` should show account `316643066568`; `aws apigateway get-rest-apis --region ap-south-1 --query "items[?name=='carelog-staging-api'].id"` should return `3mni7nx5bf` |
| `./gradlew installDebug` errors `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Existing APK on device has incompatible signing | `adb uninstall com.carelog` first |
| `./gradlew assembleDebug` errors with `R8` OOM | Gradle JVM heap too small | Check `android/gradle.properties` has `org.gradle.jvmargs=-Xmx6144m`; do NOT downgrade — release minify OOMs at 2 GiB |
| App opens but every screen shows "Network error" | Stale Cognito pool ID after env switch | Re-run `scripts/update-app-config.sh staging`; verify `amplifyconfiguration.json` got rewritten (`git diff` should show only the 5 Cognito/OAuth values changing — no S3 line since Matika doesn't use Amplify's Storage plugin) |
| Voice protocol session never completes | Bedrock model-access not approved in region | Should be fine in ap-south-1; verify via the staging `/health` endpoint's `bedrock: up` indicator |
| `psql: error: connection refused` on port 55433 | SSM tunnel session has timed out (short idle window) | Restart the tunnel with the detached `nohup aws ssm start-session ... &` pattern |
| Bash variable `$PSQL_ARGS` collapses to single arg | Shell word-splitting heuristic | Inline the full `psql -h ... -p ... -U ... -d ...` invocation; do NOT use a wrapper variable |
| Welcome email to patient never arrives even though caregiver email landed | Patient `+alias` address not SES-verified yet | `aws sesv2 create-email-identity --email-identity <patient_email>`; have them click link before the voice onboarding session pivots |
| Alarm SNS emails not arriving | Subscription stuck in `PendingConfirmation` | `aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:ap-south-1:316643066568:carelog-staging-operator-alerts --region ap-south-1` — Endpoint must show a real ARN, not "PendingConfirmation". Click the confirm-subscription link if pending. |
| `Cognito UpdateUserPool: InvalidParameterException: SES Configuration Set does not exist` (during a staging re-apply) | Eventual-consistency race | Retry the apply; SES propagation lags Cognito's validation API by a few seconds. Fires on UPDATE only, not greenfield. |
| Adb shows `device` but `installDebug` says no device | USB permissions / device went to sleep | `adb kill-server && adb start-server`; unlock the device + re-accept the USB debugging prompt |
