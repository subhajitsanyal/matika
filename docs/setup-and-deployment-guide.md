# CareLog Setup and Deployment Guide

**Version:** 2.0
**Last Updated:** March 2026

---

## 1. Prerequisites

### 1.1 Required Software

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20.x+ | Backend Lambda functions (AWS SDK v3.973+ requires Node 20) |
| npm | 9.x+ | Package management |
| Terraform | 1.5.x+ | Infrastructure as Code |
| AWS CLI | 2.x | AWS service interaction |
| Android Studio | Hedgehog (2023.1.1)+ | Android development |
| Xcode | 15.0+ | iOS development (macOS only) |
| Java JDK | 17 | Android builds |
| Firebase CLI | Latest | App distribution |
| Fastlane | Latest | Build automation |

### 1.2 Install (macOS)

```bash
brew install node@20 terraform awscli cocoapods fastlane openjdk@17
npm install -g firebase-tools

echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Android Studio:** Download from [developer.android.com](https://developer.android.com/studio). Install SDK Platform 34, Build-Tools 34.0.0, Android Emulator, and HAXM.

**Xcode:** Install from Mac App Store, then run `xcode-select --install`.

### 1.3 AWS Account Setup

```bash
aws configure
# Access Key ID:     <your-key>
# Secret Access Key: <your-secret>
# Default region:    ap-south-1
# Output format:     json
```

You need `AdministratorAccess` for initial setup, or a scoped policy covering VPC, Cognito, API Gateway, RDS, S3, SQS, SNS, EC2, IAM, KMS, CloudWatch, and Secrets Manager.

### 1.4 SES Email Setup (Recommended)

Cognito's built-in email has a **50 emails/day limit**. Configure SES to remove this limit.

#### 1.4.1 Verify Sender Email

```bash
aws ses verify-email-identity --email-address YOUR_EMAIL@yourdomain.com --region ap-south-1
```

You'll receive a verification email — click the link. Confirm it's verified:

```bash
aws ses get-identity-verification-attributes --identities YOUR_EMAIL@yourdomain.com --region ap-south-1
# Should show: "VerificationStatus": "Success"
```

#### 1.4.2 Verify Recipient Emails (Sandbox Mode)

New SES accounts are in **sandbox mode** — you can only send TO verified emails. Verify any email addresses you'll test with:

```bash
aws ses verify-email-identity --email-address your-test-email@gmail.com --region ap-south-1
```

#### 1.4.3 Add to Terraform Config

Add to your `terraform.tfvars` (§3.2):

```hcl
ses_email_arn  = "arn:aws:ses:ap-south-1:YOUR_ACCOUNT_ID:identity/YOUR_EMAIL@yourdomain.com"
ses_from_email = "CareLog <YOUR_EMAIL@yourdomain.com>"
```

Without these, Cognito uses its built-in email (50/day limit, generic sender).

#### 1.4.4 Request Production Access (Before Launch)

To send to any email address without verification, request SES sandbox exit:

```bash
aws sesv2 put-account-details \
    --production-access-enabled \
    --mail-type TRANSACTIONAL \
    --website-url "https://carelog.app" \
    --use-case-description "CareLog health monitoring app - user verification and invite emails" \
    --contact-language EN \
    --region ap-south-1
```

AWS reviews and approves within 24–48 hours.

### 1.5 Firebase Project Setup

1. Create project `carelog` at [Firebase Console](https://console.firebase.google.com)
2. Add Android app (`com.carelog`) → download `google-services.json`
3. Add iOS app (`com.carelog.CareLog`) → download `GoogleService-Info.plist`
4. Enable Firebase App Distribution

---

## 2. Clone the Repository

```bash
git clone git@github.com:subhajitsanyal/matika.git
cd matika
```

---

## 3. Backend Deployment

### 3.0 Clean Up Previous Deployments

If you have infrastructure from a prior deployment, tear it down first to avoid state conflicts, orphaned resources, and naming collisions.

#### 3.0.1 Destroy Terraform-Managed Resources

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform destroy
```

Review the plan and confirm. RDS deletion takes several minutes.

#### 3.0.2 Clean Up Resources That Survive `terraform destroy`

Some resources have deletion protection or deferred deletion. Clean them up manually:

```bash
# Force-delete Secrets Manager secrets (otherwise they wait 7–30 days)
aws secretsmanager delete-secret --secret-id carelog-dev-db-password \
    --force-delete-without-recovery --region ap-south-1

# Delete any leftover CloudWatch log groups
for lg in $(aws logs describe-log-groups --log-group-name-prefix /aws/vpc/carelog-dev \
    --query 'logGroups[].logGroupName' --output text --region ap-south-1); do
    echo "Deleting $lg"
    aws logs delete-log-group --log-group-name "$lg" --region ap-south-1
done

for lg in $(aws logs describe-log-groups --log-group-name-prefix /aws/apigateway/carelog-dev \
    --query 'logGroups[].logGroupName' --output text --region ap-south-1); do
    echo "Deleting $lg"
    aws logs delete-log-group --log-group-name "$lg" --region ap-south-1
done

for lg in $(aws logs describe-log-groups --log-group-name-prefix /aws/lambda/carelog-dev \
    --query 'logGroups[].logGroupName' --output text --region ap-south-1); do
    echo "Deleting $lg"
    aws logs delete-log-group --log-group-name "$lg" --region ap-south-1
done
```

#### 3.0.3 Reset Local Terraform State

```bash
cd infrastructure/terraform/environments/dev
rm -rf .terraform terraform.tfstate terraform.tfstate.backup tfplan .terraform.lock.hcl
```

You're now ready for a clean deployment.

### 3.1 What Terraform Creates

A single `terraform apply` deploys everything:

| Resource | Details |
|----------|---------|
| VPC | Public/private subnets, NAT gateways, security groups |
| Cognito | User Pool with 4 groups (patients, attendants, relatives, doctors), OAuth clients, post-confirmation Lambda trigger |
| API Gateway | REST API with Cognito authorizer, Lambda proxy integrations |
| Lambda | 8 deployed functions + 2 MOCK-stubbed routes (see §5) |
| RDS | PostgreSQL 15 in private subnet, encrypted, password in Secrets Manager |
| S3 | Documents + observations bucket (KMS encrypted, lifecycle rules) + access logs bucket |
| SQS | Document processing queue + alerts queue (both with DLQs) |
| SNS | Push notification platform apps (APNs, FCM) + alert topics |
| Bastion | EC2 instance for SSM port-forwarding to RDS (dev only) |

### 3.2 Configure Environment Variables

```bash
cd infrastructure/terraform/environments/dev
```

A `terraform.tfvars` should exist (gitignored). If not, create one:

```hcl
environment          = "dev"
aws_region           = "ap-south-1"
vpc_cidr             = "10.0.0.0/16"
availability_zones   = ["ap-south-1a", "ap-south-1b"]
public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24"]
s3_bucket_prefix     = "carelog-v2"
db_instance_class    = "db.t3.micro"
db_name              = "carelog_dev"
db_username          = "carelog_dev_admin"
enable_healthlake    = false
enable_waf           = false
enable_bastion       = true

# SES email (optional — omit to use Cognito default with 50/day limit)
# ses_email_arn  = "arn:aws:ses:ap-south-1:YOUR_ACCOUNT_ID:identity/your-email@domain.com"
# ses_from_email = "CareLog <your-email@domain.com>"
```

### 3.3 Install Lambda Dependencies (before Terraform)

Terraform zips each Lambda directory for deployment, so `node_modules/` must exist first:

```bash
cd backend/lambdas
for dir in */; do
    if [ -f "$dir/package.json" ]; then
        echo "=== $dir ==="
        cd "$dir" && npm install && cd ..
    fi
done
cd ../../infrastructure/terraform/environments/dev
```

### 3.4 Deploy Infrastructure + Lambdas

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

This deploys everything in one step: VPC, Cognito, RDS, S3, SQS, SNS, API Gateway, all 8 Lambda functions, and the Cognito post-confirmation trigger. RDS creation takes 5–15 minutes on first deploy; Lambda functions take 2–7 minutes each (VPC ENI setup).

### 3.5 Note the Outputs

```bash
terraform output
```

Key outputs: `vpc_id`, `bastion_instance_id`, `public_subnet_ids`, `private_subnet_ids`, `api_gateway_url`.

### 3.6 Update App Configs After Deploy

After every `terraform apply`, run the config update script to sync the app with the new infrastructure values (API Gateway URL, Cognito pool IDs, S3 bucket name):

```bash
# From the project root
./scripts/update-app-config.sh          # defaults to dev environment
./scripts/update-app-config.sh staging  # or specify another environment
```

This script queries AWS for the current:
- **API Gateway URL** (changes on every `terraform destroy` + `apply`)
- **Cognito User Pool ID and App Client ID**
- **S3 documents bucket name**

And updates these files automatically:
- `android/app/src/main/java/com/carelog/core/BuildConfig.kt`
- `android/app/src/main/res/raw/amplifyconfiguration.json`
- `ios/CareLog/CareLog/amplifyconfiguration.json`
- `android/app/build.gradle.kts` (debug build URL)

Then rebuild and distribute:

```bash
cd android
./gradlew assembleDebug
bundle exec fastlane distribute_debug
```

> **Important:** Never hardcode API Gateway IDs in source files. Always use `update-app-config.sh`
> after infrastructure changes. The API Gateway ID changes on every fresh `terraform apply`.

### 3.7 Troubleshooting Deployment Issues

**Secrets Manager: "secret already scheduled for deletion"**
```bash
aws secretsmanager delete-secret --secret-id carelog-dev-db-password --force-delete-without-recovery --region ap-south-1
terraform apply
```

**IAM Role/Instance Profile: "already exists"**
```bash
terraform import 'module.carelog.module.bastion[0].aws_iam_role.bastion' carelog-dev-bastion-role
terraform import 'module.carelog.module.bastion[0].aws_iam_instance_profile.bastion' carelog-dev-bastion-profile
terraform apply
```

**CloudWatch Log Group: "already exists"**
```bash
terraform import module.carelog.module.vpc.aws_cloudwatch_log_group.vpc_flow_logs /aws/vpc/carelog-dev-flow-logs
terraform apply
```

**S3 Bucket: 409 Conflict** — S3 names are globally unique. If recently deleted, wait 5–10 minutes or change `s3_bucket_prefix`.

---

## 4. Database Setup

### 4.1 One-Time Prerequisites

```bash
brew install --cask session-manager-plugin
brew install flyway
```

### 4.2 Start Port-Forwarding (Terminal 1)

Get connection details, then start the SSM session:

```bash
cd infrastructure/terraform/environments/dev

BASTION_ID=$(terraform output -raw bastion_instance_id)
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier carelog-dev --region ap-south-1 --query 'DBInstances[0].Endpoint.Address' --output text)

aws ssm start-session \
    --target $BASTION_ID \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"$RDS_ENDPOINT\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5432\"]}" \
    --region ap-south-1
```

You should see `Port 5432 opened for sessionId ...`. Keep this terminal open.

**If connection fails with "Connection to destination port failed":** The RDS security group is missing a rule for the bastion. Fix it:

```bash
RDS_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=*carelog*rds*" --query 'SecurityGroups[0].GroupId' --output text --region ap-south-1)
BASTION_SG=$(aws ec2 describe-instances --instance-ids $BASTION_ID --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text --region ap-south-1)

aws ec2 authorize-security-group-ingress \
    --group-id $RDS_SG --protocol tcp --port 5432 \
    --source-group $BASTION_SG --region ap-south-1
```

Then restart the SSM session.

### 4.3 Run Migrations (Terminal 2)

Retrieve the auto-generated password from Secrets Manager:

```bash
aws secretsmanager get-secret-value --secret-id carelog-dev-db-password --region ap-south-1 \
    --query 'SecretString' --output text | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['password'])"
```

Create `flyway.conf` (this file is gitignored — do not commit it):

```bash
cd backend/database

cat > flyway.conf << 'EOF'
flyway.url=jdbc:postgresql://localhost:5432/carelog_dev
flyway.user=carelog_dev_admin
flyway.password=PASTE_PASSWORD_HERE
flyway.locations=filesystem:./migrations
EOF

flyway migrate
```

---

## 5. Lambda Functions

### 5.1 Overview

Lambda functions live in `backend/lambdas/`. Each has its own `package.json` and `index.js`. Terraform packages and deploys them automatically via `archive_file` data sources in the Lambda module (`infrastructure/terraform/modules/lambda/`).

**Important:** You must run `npm install` in each Lambda directory **before** `terraform apply`, since Terraform zips the entire directory (including `node_modules/`) for deployment.

### 5.2 Install Dependencies

```bash
cd backend/lambdas

for dir in */; do
    if [ -f "$dir/package.json" ]; then
        echo "Installing dependencies for $dir"
        cd "$dir"
        npm install
        cd ..
    fi
done
```

> **Note:** All `@aws-sdk/*` dependencies must be `^3.978.0` or later to avoid critical vulnerabilities in `fast-xml-parser` and transitive `@aws-sdk/core` packages (patched in v3.973+).

### 5.3 Lambda Environment Variables

These are set automatically by Terraform when the Lambda module deploys:

| Variable | Source | Which Lambdas |
|----------|--------|---------------|
| `DB_SECRET_NAME` | RDS module → `db_password_secret_name` | post-confirmation, create-patient, accept-invite, invite-attendant, invite-doctor |
| `COGNITO_USER_POOL_ID` | Cognito module → extracted from ARN | post-confirmation, create-patient, accept-invite |
| `FROM_EMAIL` | Terraform variable (default: `noreply@carelog.com`) | invite-attendant, invite-doctor |
| `S3_BUCKET_NAME` | S3 module → `documents_bucket_name` | sync-observation, bulk-sync, presigned-url |
| `S3_KMS_KEY_ID` | S3 module → `kms_key_arn` | sync-observation, bulk-sync |

### 5.4 Lambda Functions Reference

#### Deployed (8 functions — packaged and deployed by Terraform)

| Lambda | Route | Description |
|--------|-------|-------------|
| `create-patient` | `POST /patients` | Creates patient in RDS + Cognito |
| `invite-attendant` | `POST /invites/attendant` | Sends invite email via SES |
| `invite-doctor` | `POST /invites/doctor` | Sends invite email via SES |
| `accept-invite` | `POST /invites/accept` | Creates Cognito account for invitee (no auth — user not yet registered) |
| `post-confirmation` | Cognito trigger | Runs after user confirms signup |
| `sync-observation` | `POST /observations/sync` | Stores FHIR Observation as JSON in S3 (`observations/{patientId}/{YYYY}/{MM}/{DD}/{id}.json`, KMS encrypted) |
| `bulk-sync` | `POST /observations/bulk-sync` | Batch stores FHIR resources in S3 |
| `presigned-url` | `POST /documents/presigned-url` | Generates S3 presigned upload/download URLs |

#### MOCK-Stubbed Routes (API Gateway routes exist but return mock responses — Lambda code exists but not yet wired in Terraform)

| Lambda | Route | Description |
|--------|-------|-------------|
| `delete-patient` | `DELETE /patients/{patientId}` | Cascade-deletes patient, disables Cognito accounts, sends notifications |
| `remove-team-member` | `DELETE /patients/{patientId}/team/{memberId}` | Removes team member, disables Cognito account |

#### Planned API Resources (API Gateway resources defined, no methods/integrations yet)

| Path | Intended Lambda(s) |
|------|---------------------|
| `/thresholds`, `/thresholds/{patientId}` | `threshold-crud` |
| `/reminders`, `/reminders/{patientId}` | `reminder-crud` |
| `/alerts` | `alert-crud` |
| `/device-tokens` | `device-token` |
| `/audit-log` | `audit-log` |

#### Scaffolded (code in `backend/lambdas/` but not yet in Terraform)

`account-deletion`, `alert-crud`, `audit-log`, `care-plan`, `consent`, `create-document-reference`, `data-export`, `device-token`, `doctor-documents`, `doctor-patients`, `notification-sender`, `observation-annotation`, `reminder-crud`, `threshold-crud`

### 5.6 Persona Flow

1. Only **caregivers** (persona: `relative`) can self-register via the app
2. Caregivers create a patient → `create-patient`
3. Caregivers invite attendants/doctors → `invite-attendant` / `invite-doctor`
4. Invitees receive email, accept → `accept-invite` creates their Cognito account
5. Caregivers can remove members (`remove-team-member`) or delete entire patient cascade (`delete-patient`)

---

## 6. Configure Amplify (Mobile Apps)

After Terraform deploys, retrieve the values needed for mobile app configuration:

```bash
AWS_REGION=ap-south-1

COGNITO_USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region $AWS_REGION \
    --query 'UserPools[?Name==`carelog-dev-users`].Id' --output text)

COGNITO_APP_CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id $COGNITO_USER_POOL_ID \
    --region $AWS_REGION --query 'UserPoolClients[?ClientName==`carelog-mobile-client`].ClientId' --output text)

COGNITO_WEB_DOMAIN=$(aws cognito-idp describe-user-pool --user-pool-id $COGNITO_USER_POOL_ID \
    --region $AWS_REGION --query 'UserPool.Domain' --output text).auth.$AWS_REGION.amazoncognito.com

S3_BUCKET_NAME=$(aws s3 ls | grep carelog | grep documents | awk '{print $3}')

API_GATEWAY_ID=$(aws apigateway get-rest-apis --region $AWS_REGION \
    --query 'items[?name==`carelog-dev-api`].id' --output text)
API_GATEWAY_URL=https://$API_GATEWAY_ID.execute-api.$AWS_REGION.amazonaws.com/dev

echo "COGNITO_USER_POOL_ID:  $COGNITO_USER_POOL_ID"
echo "COGNITO_APP_CLIENT_ID: $COGNITO_APP_CLIENT_ID"
echo "COGNITO_WEB_DOMAIN:    $COGNITO_WEB_DOMAIN"
echo "S3_BUCKET_NAME:        $S3_BUCKET_NAME"
echo "API_GATEWAY_URL:       $API_GATEWAY_URL"
```

Then update both Amplify config files automatically using the variables above:

```bash
# Update Android config
ANDROID_CONFIG=android/app/src/main/res/raw/amplifyconfiguration.json
sed -i '' \
    -e "s|\${COGNITO_USER_POOL_ID}|$COGNITO_USER_POOL_ID|g" \
    -e "s|\${COGNITO_APP_CLIENT_ID}|$COGNITO_APP_CLIENT_ID|g" \
    -e "s|\${COGNITO_WEB_DOMAIN}|$COGNITO_WEB_DOMAIN|g" \
    -e "s|\${AWS_REGION}|$AWS_REGION|g" \
    -e "s|\${S3_BUCKET_NAME}|$S3_BUCKET_NAME|g" \
    "$ANDROID_CONFIG"

# Update iOS config
IOS_CONFIG=ios/CareLog/CareLog/amplifyconfiguration.json
sed -i '' \
    -e "s|\${COGNITO_USER_POOL_ID}|$COGNITO_USER_POOL_ID|g" \
    -e "s|\${COGNITO_APP_CLIENT_ID}|$COGNITO_APP_CLIENT_ID|g" \
    -e "s|\${COGNITO_WEB_DOMAIN}|$COGNITO_WEB_DOMAIN|g" \
    -e "s|\${AWS_REGION}|$AWS_REGION|g" \
    -e "s|\${S3_BUCKET_NAME}|$S3_BUCKET_NAME|g" \
    "$IOS_CONFIG"

# Verify
echo "=== Android ==="
grep -E 'PoolId|AppClientId|Region|WebDomain' "$ANDROID_CONFIG"
echo "=== iOS ==="
grep -E 'PoolId|AppClientId|Region|WebDomain|bucket' "$IOS_CONFIG"
```

> **Note:** If re-running after a fresh `terraform apply` with new resource IDs, reset the config files first with `git restore` before running the sed commands again.

---

## 7. Android Development

### 7.1 Setup

1. Open `matika/android` in Android Studio
2. Wait for Gradle sync
3. Copy `google-services.json` to `android/app/`

### 7.2 Create Emulator

In Android Studio: **Tools → Device Manager → Create Device → Pixel 6 → API 34**

### 7.3 Run

```bash
cd android

# Emulator
emulator -list-avds
emulator -avd Pixel_6_API_34 &

# Build + install
./gradlew installDebug

# Or launch directly
adb shell am start -n com.carelog/.ui.MainActivity
```

### 7.4 Build APKs

```bash
./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

Release builds require a keystore in `local.properties`:

```properties
RELEASE_STORE_FILE=../carelog-release.keystore
RELEASE_STORE_PASSWORD=your_keystore_password
RELEASE_KEY_ALIAS=carelog
RELEASE_KEY_PASSWORD=your_key_password
```

Generate one with: `keytool -genkey -v -keystore carelog-release.keystore -alias carelog -keyalg RSA -keysize 2048 -validity 10000`

### 7.5 Tests

```bash
./gradlew test                    # Unit tests
./gradlew connectedAndroidTest    # Instrumentation tests (requires emulator)
```

---

## 8. iOS Development

### 8.1 Setup

```bash
cd ios/CareLog
open CareLog.xcodeproj    # or CareLog.xcworkspace if using CocoaPods
```

Copy `GoogleService-Info.plist` to `ios/CareLog/CareLog/` and add it to the Xcode project.

Configure signing: **Project → CareLog target → Signing & Capabilities → select your Team**.

### 8.2 Run in Simulator

```bash
xcrun simctl boot "iPhone 15 Pro"

xcodebuild -scheme CareLog \
    -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build

xcrun simctl install booted build/Debug-iphonesimulator/CareLog.app
xcrun simctl launch booted com.carelog.CareLog
```

Or use Xcode: select simulator from dropdown, press `Cmd + R`.

### 8.3 Tests

```bash
xcodebuild test -scheme CareLog \
    -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
```

---

## 9. Firebase App Distribution

### 9.1 Prerequisites

| Tool | Install | Purpose |
|------|---------|---------|
| Ruby (Homebrew) | `brew install ruby` | Fastlane runtime (macOS system Ruby is too old) |
| Bundler | `gem install bundler` | Ruby dependency management |
| Firebase CLI | `brew install firebase-cli` | Tester management, direct uploads |
| JDK 17 | `brew install openjdk@17` | Android builds via Gradle |

**Shell environment** (add to `~/.zshrc`):

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:$JAVA_HOME/bin:$PATH"
```

Also symlink JDK so the system can find it:

```bash
sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk
```

**Android SDK** must be discoverable by Gradle. Create `android/local.properties`:

```properties
sdk.dir=/opt/homebrew/share/android-commandlinetools
```

Or if using Android Studio, it typically installs at `~/Library/Android/sdk`.

### 9.2 Firebase Authentication

```bash
# Login to Firebase (opens browser)
firebase login

# Generate a CI token for automated distribution
firebase login:ci
# Save the printed token — you'll use it as FIREBASE_TOKEN
```

**Firebase project:** `carelog-7de0c`
**Android App ID:** `1:191872106923:android:63245761468592e0d612ee`

### 9.3 Install Fastlane Dependencies

```bash
cd android
bundle install    # Installs fastlane + firebase_app_distribution plugin from Gemfile
```

The `Gemfile` and `fastlane/` directory are already configured in the repo.

### 9.4 Android Distribution (Fastlane)

Three distribution lanes are available:

| Lane | Build Type | Tester Groups | Command |
|------|-----------|---------------|---------|
| `distribute_debug` | Debug APK | `internal-testers` | `bundle exec fastlane distribute_debug` |
| `distribute` | Release APK | `internal-testers`, `qa-team` | `bundle exec fastlane distribute` |
| `beta` | Release APK | `beta-testers` | `bundle exec fastlane beta` |

**Distribute a debug build to internal testers:**

```bash
cd android
export FIREBASE_TOKEN="<your-firebase-ci-token>"
bundle exec fastlane distribute_debug
```

This will:
1. Build the debug APK (`./gradlew clean assembleDebug`)
2. Generate release notes from recent git commits
3. Upload APK to Firebase App Distribution
4. Distribute to the `internal-testers` group
5. Testers receive an email with a download link

**Distribute a release build** (requires signing credentials):

```bash
cd android
export FIREBASE_TOKEN="<your-firebase-ci-token>"
export KEYSTORE_PATH="/path/to/release.keystore"
export KEYSTORE_PASSWORD="<password>"
export KEY_ALIAS="<alias>"
export KEY_PASSWORD="<key-password>"
bundle exec fastlane distribute
```

**Custom release notes:**

```bash
bundle exec fastlane distribute_debug release_notes:"Fix persona routing and history bugs"
```

### 9.5 Creating Tester Groups

Before distributing, create the tester groups in Firebase:

```bash
# Create groups
firebase appdistribution:group:create internal-testers "Internal Testers" --project carelog-7de0c
firebase appdistribution:group:create qa-team "QA Team" --project carelog-7de0c
firebase appdistribution:group:create beta-testers "Beta Testers" --project carelog-7de0c
```

### 9.6 Managing Testers

```bash
# Add testers to a group
firebase appdistribution:testers:add \
  --emails "dev1@example.com,dev2@example.com" \
  --group-aliases internal-testers \
  --project carelog-7de0c

# List all testers
firebase appdistribution:testers:list --project carelog-7de0c

# Remove a tester
firebase appdistribution:testers:remove \
  --emails "old-tester@example.com" \
  --project carelog-7de0c
```

Or manage testers via the [Firebase Console](https://console.firebase.google.com/project/carelog-7de0c/appdistribution).

### 9.7 iOS Distribution

```bash
cd ios/CareLog
bundle install
export FIREBASE_TOKEN="<your-firebase-ci-token>"
bundle exec fastlane distribute
```

Requires ad-hoc provisioning profile. Set up with:

```bash
fastlane match init
fastlane match adhoc
```

### 9.8 GitHub Actions (Automated)

The CI workflow (`.github/workflows/android-ci.yml`) automatically distributes to `internal-testers` on pushes to `develop`:

```bash
# Merge to develop to trigger automatic distribution
git checkout develop
git merge main
git push origin develop
```

**Required GitHub Secrets** (configure in repo Settings → Secrets):

| Secret | Value |
|--------|-------|
| `FIREBASE_APP_ID` | `1:191872106923:android:63245761468592e0d612ee` |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON content |

### 9.9 Troubleshooting Firebase Distribution

| Error | Cause | Fix |
|-------|-------|-----|
| `Unable to locate a Java Runtime` | JAVA_HOME not set | `export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home` |
| `SDK location not found` | Missing local.properties | Create `android/local.properties` with `sdk.dir=<path-to-sdk>` |
| `Keystore file not found for signing config 'externalOverride'` | Fastlane injects empty signing env vars | Use `distribute_debug` lane (no signing needed) or set `KEYSTORE_*` env vars |
| `Invalid request` during distribution | Tester group doesn't exist | Create group first: `firebase appdistribution:group:create <name> "<display>" --project carelog-7de0c` |
| `Could not locate Gemfile` | Wrong directory | Run from `android/` directory, not project root |

Get Firebase App IDs from: **Firebase Console → Project Settings → General → Your apps**.

---

## 10. Troubleshooting

### Verifying Observation Sync (Android)

After building and deploying the app, verify that FHIR observations sync correctly from the device to S3:

1. **Build and install:**
   ```bash
   cd android && ./gradlew clean installDebug
   ```

2. **Log a reading** (e.g. blood pressure) in the app.

3. **Force restart the app** to trigger `FhirSyncWorker`:
   ```bash
   adb shell am force-stop com.carelog
   adb shell monkey -p com.carelog -c android.intent.category.LAUNCHER 1
   ```

4. **Watch sync logs:**
   ```bash
   adb logcat -s "FhirSyncWorker" "HealthLakeFhirClient" | grep -i "sync\|error\|observation"
   ```

5. **After ~1 minute, verify observations landed in S3:**
   ```bash
   aws s3 ls s3://<YOUR_BUCKET>/observations/ --recursive --region ap-south-1
   ```

> **Note:** If observations don't appear, check that the app sets `id=null` on new observations before saving to Room DB — this ensures they enter the sync queue as `PENDING` rather than being marked `SYNCED` immediately.

### Android

```bash
./gradlew clean && rm -rf ~/.gradle/caches/    # Gradle sync failed
emulator -avd Pixel_6_API_34 -no-snapshot-load  # Emulator not starting
```

### iOS

```bash
# Pod install fails
sudo gem install cocoapods && pod cache clean --all && rm -rf Pods Podfile.lock && pod install

# SPM resolution fails
rm -rf ~/Library/Caches/org.swift.swiftpm ~/Library/Developer/Xcode/DerivedData
# Then in Xcode: File → Packages → Reset Package Caches
```

### Backend

```bash
# Terraform state lock
terraform force-unlock LOCK_ID

# Lambda logs
aws logs tail /aws/lambda/carelog-dev-FUNCTION-NAME --follow --region ap-south-1

# Manual Lambda code update
aws lambda update-function-code --function-name carelog-dev-FUNCTION-NAME --zip-file fileb://function.zip --region ap-south-1
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Deploy infrastructure + Lambdas | `cd infrastructure/terraform/environments/dev && terraform apply` |
| Port-forward to RDS | `aws ssm start-session --target BASTION_ID ...` (see §4.2) |
| Run DB migrations | `cd backend/database && flyway migrate` |
| Install Lambda deps | `cd backend/lambdas/FUNCTION && npm install` |
| Android debug build | `cd android && ./gradlew assembleDebug` |
| Android tests | `cd android && ./gradlew test` |
| iOS build | `cd ios/CareLog && xcodebuild -scheme CareLog -destination '...' build` |
| iOS tests | `cd ios/CareLog && xcodebuild test -scheme CareLog -destination '...'` |
| Distribute Android | `cd android && fastlane distribute` |
| Distribute iOS | `cd ios/CareLog && fastlane distribute` |
| View Lambda logs | `aws logs tail /aws/lambda/carelog-dev-FUNCTION --follow` |

---

## FAQ

### How do I reset the database and remove all users?

**1. Delete all Cognito users:**

```bash
POOL_ID="ap-south-1_uiEZhWVXB"
REGION="ap-south-1"

# List all users first
aws cognito-idp list-users --user-pool-id $POOL_ID --region $REGION \
    --query 'Users[].{Username:Username,Status:UserStatus}' --output table

# Delete all users (handles usernames with special characters correctly)
aws cognito-idp list-users --user-pool-id $POOL_ID --region $REGION \
    --query 'Users[].Username' --output json | \
    python3 -c "
import json, sys, subprocess
users = json.load(sys.stdin)
print(f'Deleting {len(users)} users...')
for u in users:
    print(f'  Deleting {u}')
    subprocess.run(['aws', 'cognito-idp', 'admin-delete-user',
        '--user-pool-id', '$POOL_ID', '--username', u, '--region', '$REGION'],
        capture_output=True)
print('Done.')
"

# Verify pool is empty
aws cognito-idp list-users --user-pool-id $POOL_ID --region $REGION \
    --query 'Users[].Username'
# Should output: []
```

> **Note:** The `--output text` format joins usernames with tabs which breaks `for` loops.
> Always use `--output json` with `python3` for reliable parsing.

**2. Delete a single user:**

```bash
aws cognito-idp admin-delete-user \
    --user-pool-id ap-south-1_uiEZhWVXB \
    --username "USERNAME_OR_SUB_UUID" \
    --region ap-south-1
```

**3. Reset the database** (requires SSM port-forward running in another terminal):

```bash
cd backend/database
echo 'flyway.cleanDisabled=false' >> flyway.conf
flyway clean    # drops all objects
flyway migrate  # recreates schema from scratch
```

> **Warning:** `flyway clean` drops everything — only use in dev.

### How do I create pre-confirmed test accounts?

Useful for testing without email verification:

```bash
POOL_ID="ap-south-1_uiEZhWVXB"
CLIENT_ID="1kjdqj21bljak87e602d8r84f2"
REGION="ap-south-1"
PASSWORD="Carelog2026@x"

# Create and confirm a user in one go
EMAIL="testuser@example.com"
NAME="Test User"
PERSONA="relative"  # or: patient, attendant, doctor

aws cognito-idp sign-up --client-id $CLIENT_ID --username "$EMAIL" \
    --password "$PASSWORD" \
    --user-attributes "Name=email,Value=$EMAIL" "Name=name,Value=$NAME" \
    --region $REGION

aws cognito-idp admin-confirm-sign-up \
    --user-pool-id $POOL_ID --username "$EMAIL" --region $REGION

aws cognito-idp admin-update-user-attributes \
    --user-pool-id $POOL_ID --username "$EMAIL" \
    --user-attributes "Name=custom:persona_type,Value=$PERSONA" \
    --region $REGION
```

> **Note:** `custom:persona_type` cannot be sent during `sign-up` via Amplify — it must
> be set afterwards via `admin-update-user-attributes` or through the app's post-sign-in
> `flushPendingPersona()` flow.

### How do I manually confirm a user (skip email verification)?

```bash
POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region ap-south-1 \
    --query 'UserPools[?Name==`carelog-dev-users`].Id' --output text)

aws cognito-idp admin-confirm-sign-up \
    --user-pool-id $POOL_ID \
    --username USERNAME_OR_SUB \
    --region ap-south-1
```

This also triggers the post-confirmation Lambda.

### How do I reset a user's password?

```bash
aws cognito-idp admin-set-user-password \
    --user-pool-id $POOL_ID \
    --username USERNAME_OR_SUB \
    --password 'NewP@ssw0rd' \
    --permanent \
    --region ap-south-1
```

Password must meet policy: 8+ chars, uppercase, lowercase, number, symbol.

### How do I check Lambda logs?

```bash
# Follow logs in real time
aws logs tail /aws/lambda/carelog-dev-FUNCTION-NAME --follow --region ap-south-1

# View last 5 minutes
aws logs tail /aws/lambda/carelog-dev-FUNCTION-NAME --since 5m --region ap-south-1
```

Deployed function names: `post-confirmation`, `create-patient`, `accept-invite`, `invite-attendant`, `invite-doctor`, `sync-observation`, `bulk-sync`, `presigned-url`.

### How do I get the database password?

```bash
aws secretsmanager get-secret-value --secret-id carelog-dev-db-password --region ap-south-1 \
    --query 'SecretString' --output text | \
    python3 -c "import sys,json; print(json.loads(sys.stdin.read())['password'])"
```

### Not receiving Cognito verification emails?

1. Check spam/junk folder
2. If using Cognito default email: daily limit is 50 — switch to SES (see §1.4)
3. If using SES in sandbox mode: recipient email must be verified too (`aws ses verify-email-identity`)
4. Resend code: `aws cognito-idp resend-confirmation-code --client-id CLIENT_ID --username USERNAME --region ap-south-1`
5. Skip email and confirm manually: see "How do I manually confirm a user" above

### "Could not find the required online resource" when signing in?

The app has a stale Cognito Pool ID from a previous deployment. After `terraform destroy` + `terraform apply`, the pool ID changes. Re-run the Amplify config update (§6):

```bash
cd /path/to/matika

AWS_REGION=ap-south-1
COGNITO_USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region $AWS_REGION \
    --query 'UserPools[?Name==`carelog-dev-users`].Id' --output text)
COGNITO_APP_CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id $COGNITO_USER_POOL_ID \
    --region $AWS_REGION --query 'UserPoolClients[?ClientName==`carelog-mobile-client`].ClientId' --output text)
COGNITO_WEB_DOMAIN=$(aws cognito-idp describe-user-pool --user-pool-id $COGNITO_USER_POOL_ID \
    --region $AWS_REGION --query 'UserPool.Domain' --output text).auth.$AWS_REGION.amazoncognito.com
S3_BUCKET_NAME=$(aws s3 ls | grep carelog | grep documents | awk '{print $3}')

# Reset to placeholders then substitute
git restore android/app/src/main/res/raw/amplifyconfiguration.json
git restore ios/CareLog/CareLog/amplifyconfiguration.json

sed -i '' \
    -e "s|\${COGNITO_USER_POOL_ID}|$COGNITO_USER_POOL_ID|g" \
    -e "s|\${COGNITO_APP_CLIENT_ID}|$COGNITO_APP_CLIENT_ID|g" \
    -e "s|\${COGNITO_WEB_DOMAIN}|$COGNITO_WEB_DOMAIN|g" \
    -e "s|\${AWS_REGION}|$AWS_REGION|g" \
    -e "s|\${S3_BUCKET_NAME}|$S3_BUCKET_NAME|g" \
    android/app/src/main/res/raw/amplifyconfiguration.json \
    ios/CareLog/CareLog/amplifyconfiguration.json
```

Then rebuild and deploy the app.

---

*CareLog Setup and Deployment Guide v2.0 — March 2026*
