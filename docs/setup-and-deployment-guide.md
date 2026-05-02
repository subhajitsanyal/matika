# Matika Setup and Deployment Guide

**Version:** 3.2
**Last Updated:** May 2026

> **v2.0 note:** v1's Mac Mini per-household inference setup is removed. Inference now runs on AWS Bedrock (cross-region). Section 6 documents the Bedrock provisioning steps that replace the v1 Mac Mini setup. Existing AWS resource names (`carelog-*`) and Android packages (`com.carelog.*`) are deliberately retained until the v2.1 rename pass — see `docs/matika_v2_migration.md`.

---

## Quick Start (TL;DR)

If you just want to get everything running, follow these steps in order:

1. Install prerequisites (section 1)
2. Clone repo (section 2)
3. Install Lambda deps, deploy infra, run migrations (section 3)
4. Update app configs and build Android/iOS (section 4)
5. Distribute to testers (section 5)
6. Provision AWS Bedrock — model access, inference profiles, Guardrails (section 6)

---

## 1. Prerequisites

### 1.1 Required Software

```bash
# macOS (Homebrew)
brew install node@20 terraform awscli ruby openjdk@17 python@3.11 flyway
brew install --cask session-manager-plugin
npm install -g firebase-tools
gem install bundler

# Shell environment (add to ~/.zshrc)
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/3.4.0/bin:/opt/homebrew/opt/openjdk@17/bin:$PATH"
```

**Android Studio:** Download from [developer.android.com](https://developer.android.com/studio). Install SDK Platform 34, Build-Tools 34.0.0, Android Emulator.

**Xcode** (iOS only): Install from Mac App Store, then `xcode-select --install`.

### 1.2 AWS Account

```bash
aws configure
# Region: ap-south-1
# Output: json
```

You need `AdministratorAccess` or a policy covering VPC, Cognito, API Gateway, RDS, S3, SQS, SNS, EC2, IAM, KMS, CloudWatch, EventBridge, and Secrets Manager.

### 1.3 Firebase Project

1. Create project `carelog` at [Firebase Console](https://console.firebase.google.com)
2. Add Android app (`com.carelog`) -> download `google-services.json` -> place in `android/app/`
3. Add iOS app (`com.carelog.CareLog`) -> download `GoogleService-Info.plist` -> place in `ios/CareLog/CareLog/`
4. Enable Firebase Cloud Messaging (FCM) and App Distribution

### 1.4 SES Email (Optional)

Without SES, Cognito uses its built-in email (50/day limit). To remove the limit:

```bash
# Verify your sender email
aws ses verify-email-identity --email-address YOUR_EMAIL@yourdomain.com --region ap-south-1

# In sandbox mode, also verify recipient emails
aws ses verify-email-identity --email-address recipient@example.com --region ap-south-1
```

Add to `infrastructure/terraform/environments/dev/terraform.tfvars` (gitignored):

```hcl
ses_email_arn  = "arn:aws:ses:ap-south-1:YOUR_ACCOUNT_ID:identity/YOUR_EMAIL@yourdomain.com"
ses_from_email = "Matika <YOUR_EMAIL@yourdomain.com>"
```

---

## 2. Clone the Repository

```bash
git clone git@github.com:subhajitsanyal/matika.git
cd matika
```

---

## 3. Deploy AWS Backend

This deploys everything: VPC, Cognito, API Gateway, 28 Lambda functions, RDS PostgreSQL, S3 buckets, SQS queues, EventBridge rules, and CloudWatch monitoring.

### 3.1 Install Lambda Dependencies

```bash
cd backend/lambdas
for dir in */; do
    [ -f "$dir/package.json" ] && (cd "$dir" && npm install && cd ..)
done
cd ../..
```

### 3.2 Deploy Infrastructure

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

First deploy takes 15-20 minutes (RDS creation is the bottleneck).

> **Note the outputs** — you'll need `bastion_instance_id` for database access:
> ```bash
> terraform output
> ```

### 3.3 Run Database Migrations

Open **Terminal 1** — start the RDS port-forward:

```bash
BASTION_ID=$(terraform output -raw bastion_instance_id)
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier carelog-dev \
    --region ap-south-1 --query 'DBInstances[0].Endpoint.Address' --output text)

aws ssm start-session \
    --target $BASTION_ID \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"$RDS_ENDPOINT\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5432\"]}" \
    --region ap-south-1
```

Keep this terminal open. In **Terminal 2**:

```bash
# Get the auto-generated password
DB_PASS=$(aws secretsmanager get-secret-value --secret-id carelog-dev-db-password --region ap-south-1 \
    --query 'SecretString' --output text | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['password'])")

cd backend/database
cat > flyway.conf << EOF
flyway.url=jdbc:postgresql://localhost:5432/carelog_dev
flyway.user=carelog_dev_admin
flyway.password=$DB_PASS
flyway.locations=filesystem:./migrations
EOF

flyway migrate
```

> **Do not commit `flyway.conf`** — it contains the database password. It's already gitignored.

---

## 4. Build and Run the Apps

### 4.1 Update App Configs

After every `terraform apply`, sync the app with the new AWS resource IDs:

```bash
# From the project root
./scripts/update-app-config.sh
```

This updates `BuildConfig.kt`, `amplifyconfiguration.json` (Android + iOS), and `build.gradle.kts` with the current API Gateway URL, Cognito Pool/Client IDs, and S3 bucket name.

> **Important:** The API Gateway ID changes on every fresh `terraform apply`. Always run this script after infrastructure changes.

### 4.2 Android

```bash
cd android

# Ensure google-services.json is present
ls app/google-services.json || echo "MISSING — download from Firebase Console"

# Build
./gradlew assembleDebug

# Run on emulator
emulator -avd YOUR_AVD -dns-server 8.8.8.8 &
./gradlew installDebug
adb shell am start -n com.carelog/.ui.MainActivity

# Run tests
./gradlew test
```

> **Emulator DNS:** Add `hw.dns.1 = 8.8.8.8` to your AVD config or use `-dns-server 8.8.8.8` to resolve AWS hostnames.

### 4.3 iOS

```bash
cd ios/CareLog
open CareLog.xcodeproj
# Select simulator, press Cmd+R

# Or from command line:
xcodebuild -scheme CareLog -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build
```

### 4.4 Web Portal (Doctor)

```bash
cd web-portal
npm install
npm run dev    # http://localhost:5173
```

---

## 5. Distribute to Testers

### 5.1 Android (Fastlane)

```bash
cd android
bundle install

export FIREBASE_ANDROID_APP_ID="1:191872106923:android:63245761468592e0d612ee"
export FIREBASE_TOKEN="<your-firebase-ci-token>"   # from: firebase login:ci
bundle exec fastlane distribute_debug
```

> **First time?** Create tester groups first:
> ```bash
> firebase appdistribution:group:create internal-testers "Internal Testers" --project carelog-7de0c
> ```

### 5.2 iOS (Fastlane)

```bash
cd ios/CareLog
bundle install
export FIREBASE_TOKEN="<your-firebase-ci-token>"
bundle exec fastlane distribute
```

### 5.3 Web Portal (S3)

```bash
cd web-portal && npm run build
aws s3 sync dist/ s3://carelog-dev-web-portal/ --delete --region ap-south-1
```

---

## 6. AWS Bedrock Provisioning (v2)

v2 replaces the per-household Mac Mini inference stack with AWS Bedrock. Three pieces of provisioning are needed before the conversational system can run end-to-end.

### 6.1 Confirm AWS BAA Covers Bedrock Cross-Region Inference

Verify with your AWS account team that the existing Business Associate Addendum covers Bedrock invocations across the `ap-south-1` (storage) and the cross-region inference profile regions (typically `ap-southeast-1` and `us-east-1`). If not, escalate to the AWS healthcare team. **All downstream Bedrock work is blocked until this is confirmed.**

### 6.2 Request Bedrock Model Access (1–3 day SLA)

Submit access requests via the Bedrock console for the two foundation models Matika v2 uses:

```
anthropic.claude-haiku-4-5-v1:0
anthropic.claude-sonnet-4-x-v1:0
```

Request both in `ap-southeast-1` (primary) and `us-east-1` (fallback) — these are the regions the cross-region inference profiles route to. Approval typically takes 1–2 business days; submit early.

### 6.3 Create Cross-Region Inference Profiles

Once model access is granted, the `infrastructure/terraform/modules/bedrock/` module provisions the inference profiles. Resources are commented out until model access is confirmed; uncomment in `inference_profiles.tf` and `guardrail.tf`, then:

```bash
cd infrastructure/terraform/environments/dev
terraform plan -var-file=dev.tfvars -target=module.bedrock
terraform apply -var-file=dev.tfvars -target=module.bedrock
```

This creates the Haiku and Sonnet inference profiles plus the Matika Guardrail (PHI redaction, denied medical-advice topics, custom emergency triggers per `docs/matika_spec_v2.md` §11.5).

### 6.4 Submit Bedrock Quota Increase Requests

Default Bedrock quotas are typically sufficient for a 10-patient pilot, but request increases early (1–3 day SLA) to avoid blocking later phases. Target via Service Quotas console:

- Haiku: 50 RPM on each inference profile region
- Sonnet: 10 RPM on each inference profile region

### 6.5 Verify

```bash
# 1-token Bedrock smoke test against the Haiku inference profile
aws bedrock-runtime invoke-model \
  --model-id apac.anthropic.claude-haiku-4-5-v1:0 \
  --body '{"messages":[{"role":"user","content":"hi"}],"max_tokens":1,"anthropic_version":"bedrock-2023-05-31"}' \
  --content-type application/json \
  --region ap-south-1 /tmp/bedrock-test.json && cat /tmp/bedrock-test.json

# Health-check Lambda end-to-end
TOKEN=$(...)  # admin Cognito token
curl -H "Authorization: Bearer $TOKEN" \
  "https://${API_ID}.execute-api.ap-south-1.amazonaws.com/dev/health"
```

The `/health` response should show `bedrock: "up"` and a populated `bedrock_inference_region`.

---

## 7. Verify Everything Works

### 7.1 API Health Check

```bash
# Get API URL
API_URL=$(aws apigateway get-rest-apis --region ap-south-1 \
    --query 'items[?name==`carelog-dev-api`].id' --output text)
echo "https://$API_URL.execute-api.ap-south-1.amazonaws.com/dev"

# Should return 403 (auth required) — means API Gateway is working
curl -s -o /dev/null -w "%{http_code}" "https://$API_URL.execute-api.ap-south-1.amazonaws.com/dev/patients"
```

### 7.2 Lambda Health

```bash
aws lambda list-functions --region ap-south-1 \
    --query 'Functions[?starts_with(FunctionName, `carelog-dev`)].FunctionName' --output text | tr '\t' '\n' | wc -l
# Should show: 28
```

### 7.3 Database

```bash
# With port-forward active (see 3.3):
flyway info    # Should show V001-V004 as "Success"
```

### 7.4 Android App

1. Open app on emulator/device
2. Register as caregiver -> should see empty dashboard
3. Log a vital (BP: 120/80) -> should save and show in history
4. Check sync: `adb logcat -s FhirSyncWorker`

---

## 8. Clean Slate (Starting Over)

If you need to tear down everything and redeploy from scratch, see `docs/fullcleanup.md` for the complete procedure, or use the nuclear option:

```bash
cd infrastructure/terraform/environments/dev

# Phase 1: Unblock terraform destroy
REGION="ap-south-1"
for rule in $(aws events list-rules --name-prefix carelog --region $REGION --query 'Rules[].Name' --output text 2>/dev/null); do
    for target in $(aws events list-targets-by-rule --rule "$rule" --region $REGION --query 'Targets[].Id' --output text 2>/dev/null); do
        aws events remove-targets --rule "$rule" --ids "$target" --region $REGION; done
    aws events delete-rule --name "$rule" --region $REGION; done
for uuid in $(aws lambda list-event-source-mappings --region $REGION --query 'EventSourceMappings[?contains(FunctionArn, `carelog`)].UUID' --output text 2>/dev/null); do
    aws lambda delete-event-source-mapping --uuid "$uuid" --region $REGION; done

# Phase 2: Destroy
terraform destroy -auto-approve

# Phase 3: Wait for RDS, then clean orphans
# See docs/fullcleanup.md for the full script
```

---

## 9. Troubleshooting

### Terraform "already exists" errors

When a resource exists in AWS but not in Terraform state:

```bash
terraform import '<address>' '<id>'
terraform apply
```

Common ones:

| Error | Import command |
|-------|---------------|
| CloudWatch log group exists | `terraform import module.carelog.module.vpc.aws_cloudwatch_log_group.vpc_flow_logs /aws/vpc/carelog-dev-flow-logs` |
| RDS subnet group exists | `terraform import 'module.carelog.module.rds.aws_db_subnet_group.main' 'carelog-dev-db-subnet-group'` |
| S3 bucket exists | `terraform import 'module.carelog.module.s3.aws_s3_bucket.documents' 'carelog-v2-dev-documents-ACCOUNT_ID'` |

### SQS "QueueAlreadyExists"

```bash
REGION="ap-south-1"
for url in $(aws sqs list-queues --queue-name-prefix carelog --region $REGION --query 'QueueUrls[]' --output text 2>/dev/null); do
    aws sqs delete-queue --queue-url "$url" --region $REGION; done
for alias in $(aws kms list-aliases --region $REGION --query 'Aliases[?contains(AliasName, `carelog`)].AliasName' --output text 2>/dev/null); do
    aws kms delete-alias --alias-name "$alias" --region $REGION; done
sleep 60 && terraform apply
```

### EventBridge "has targets"

```bash
for rule in $(aws events list-rules --name-prefix carelog --region ap-south-1 --query 'Rules[].Name' --output text); do
    for target in $(aws events list-targets-by-rule --rule "$rule" --region ap-south-1 --query 'Targets[].Id' --output text); do
        aws events remove-targets --rule "$rule" --ids "$target" --region ap-south-1; done
    aws events delete-rule --name "$rule" --region ap-south-1; done
```

### Orphaned Lambda functions

```bash
for fn in $(aws lambda list-functions --region ap-south-1 --query 'Functions[?starts_with(FunctionName, `carelog`)].FunctionName' --output text); do
    aws lambda delete-function --function-name "$fn" --region ap-south-1; done
```

### Bastion can't reach RDS

```bash
terraform apply -target="module.carelog.module.bastion[0].aws_security_group_rule.bastion_to_rds" -auto-approve
```

### API returns 403

1. Check `custom:linked_patient_id` in Cognito is the patient **UUID** (from `patients.id`), not the string ID
2. Check `persona_links` has an active link for the user
3. Check Lambda logs: `aws logs tail /aws/lambda/carelog-dev-patient-summary --since 5m --region ap-south-1`

### App says "Could not find the required online resource"

Stale Cognito config. Re-run `./scripts/update-app-config.sh` and rebuild.

### Secrets Manager "already scheduled for deletion"

```bash
aws secretsmanager delete-secret --secret-id carelog-dev-db-password --force-delete-without-recovery --region ap-south-1
terraform apply
```

### Android: google-services.json missing

Download from [Firebase Console](https://console.firebase.google.com) -> Project Settings -> Android app -> `google-services.json`. Place in `android/app/`.

### Android: Ruby/Bundler version error

macOS system Ruby is too old. Install via Homebrew:

```bash
brew install ruby
echo 'export PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/3.4.0/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
gem install bundler && cd android && bundle install
```

---

## Reference

### Architecture

```
Mac Mini M4 (LAN)          AWS Cloud (HTTPS)
├── STT   :8001            ├── API Gateway -> 28 Lambda Functions
├── LLM   :8002            ├── RDS PostgreSQL 15
├── TTS   :8003            ├── S3 (FHIR + Raw + Documents)
├── Vision :8004           ├── SQS (Alerts + Document Processing)
└── Health :8000           ├── Cognito (5 groups)
                           ├── EventBridge (3 scheduled rules)
Android App                └── CloudWatch (6 alarms + dashboard)
├── Dual networking (LAN + Cloud)
├── mDNS discovery
└── Offline-first (Room DB + sync)

Web Portal (Doctor)
└── React/TypeScript/Vite
```

### Cognito Groups

`patients`, `caregivers`, `doctors`, `attendants` (legacy), `relatives` (legacy)

### Key Files

| File | Purpose |
|------|---------|
| `scripts/update-app-config.sh` | Syncs app configs with AWS resource IDs |
| `infrastructure/terraform/environments/dev/main.tf` | Dev environment config |
| `infrastructure/terraform/environments/dev/terraform.tfvars` | SES email config (gitignored) |
| `android/app/google-services.json` | Firebase config (gitignored) |
| `backend/database/flyway.conf` | DB credentials (gitignored) |
| `android/app/src/main/res/raw/amplifyconfiguration.json` | Cognito/S3 config |
| `android/app/src/main/java/com/carelog/core/BuildConfig.kt` | API URL |

### All 28 Lambda Functions

| Lambda | Trigger |
|--------|---------|
| post-confirmation | Cognito trigger |
| create-patient | POST /patients |
| patient-summary | GET /patients/{id}/summary |
| get-observations | GET /patients/{id}/observations |
| invite-attendant | POST /invites/attendant |
| invite-doctor | POST /invites/doctor |
| accept-invite | GET,POST /invites/accept |
| sync-observation | POST /observations/sync |
| bulk-sync | POST /observations/bulk-sync |
| presigned-url | POST /documents/presigned-url |
| care-team | GET /patients/{id}/team |
| process-pending-invites | EventBridge (2 min) |
| fetch-session-config | GET /session-config/{id} |
| construct-fhir-batch | POST /observations/batch |
| store-interaction | POST /interactions |
| evaluate-thresholds-batch | Async invoke |
| check-daily-deadline | EventBridge (15 min) |
| check-missed-measurements | EventBridge (1 hour) |
| notification-sender | SQS consumer |
| manage-recommendations | /patients/{id}/recommendations |
| manage-parameter-configs | /patients/{id}/parameter-configs |
| manage-interactions | /patients/{id}/interactions |
| manage-prompts | /prompts |
| alert-crud | /patients/{id}/alerts |
| threshold-crud | /patients/{id}/thresholds |
| device-token | /device-tokens |
| reminder-crud | /patients/{id}/reminders |
| remove-team-member | DELETE /patients/{id}/team/{mid} |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-02 | v3.2: Brand rename to Matika; replaced Mac Mini section with Bedrock provisioning section |
| 2026-04-26 | v3.1: Restructured guide into linear deployment flow; moved troubleshooting and reference to end |
| 2026-04-25 | v3.0: Added Mac Mini services, conversational system, 28 Lambdas, model download script, emulator DNS fix, nuclear cleanup |

---

*Matika Setup and Deployment Guide v3.2 — May 2026*
