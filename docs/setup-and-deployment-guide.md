# CareLog Setup and Deployment Guide

**Version:** 2.0
**Last Updated:** March 2026

---

## 1. Prerequisites

### 1.1 Required Software

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18.x+ | Backend Lambda functions |
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
brew install node@18 terraform awscli cocoapods fastlane openjdk@17
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

### 1.4 Firebase Project Setup

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

### 3.1 What Terraform Creates

Terraform deploys **infrastructure only** — not Lambda function code. After `terraform apply` you will have:

| Resource | Details |
|----------|---------|
| VPC | Public/private subnets, NAT gateways, security groups |
| Cognito | User Pool with 4 groups (patients, attendants, relatives, doctors), OAuth clients |
| API Gateway | REST API with Cognito authorizer, MOCK integrations (Lambda integration TBD) |
| RDS | PostgreSQL 15 in private subnet, encrypted, password in Secrets Manager |
| S3 | Documents bucket (KMS encrypted, lifecycle rules) + access logs bucket |
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
```

### 3.3 Deploy Infrastructure

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

RDS creation takes 5–15 minutes. This is normal.

### 3.4 Note the Outputs

```bash
terraform output
```

Key outputs: `vpc_id`, `bastion_instance_id`, `public_subnet_ids`, `private_subnet_ids`.

### 3.5 Troubleshooting Deployment Issues

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

### 5.1 Current State

Lambda functions live in `backend/lambdas/`. Each has its own `package.json` and `index.js`. **Terraform does not deploy Lambda code** — the API Gateway currently uses MOCK integrations as placeholders.

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

These are set automatically when Lambda functions are wired into Terraform (or set manually in the AWS console):

| Variable | Source | Value |
|----------|--------|-------|
| `DB_SECRET_NAME` | Terraform RDS module output `db_password_secret_name` | `carelog-dev-db-password` |
| `COGNITO_USER_POOL_ID` | Terraform Cognito module output `user_pool_id` | `ap-south-1_XxxXxxXxx` |
| `FROM_EMAIL` | Manual — must be SES-verified | defaults to `noreply@carelog.com` |

### 5.4 Cognito Custom Attributes

Required for persona-based routing. Add once after Cognito is created:

```bash
COGNITO_USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region ap-south-1 \
    --query 'UserPools[?Name==`carelog-dev-users`].Id' --output text)

aws cognito-idp add-custom-attributes \
    --user-pool-id $COGNITO_USER_POOL_ID \
    --custom-attributes \
        Name=persona_type,AttributeDataType=String,Mutable=true \
        Name=linked_patient_id,AttributeDataType=String,Mutable=true \
    --region ap-south-1
```

### 5.5 Lambda Functions Reference

| Lambda | Route | Description |
|--------|-------|-------------|
| `create-patient` | `POST /patients` | Creates patient in RDS + Cognito |
| `delete-patient` | `DELETE /patients/{patientId}` | Cascade-deletes patient, disables Cognito accounts, sends notifications |
| `invite-attendant` | `POST /invites/attendant` | Sends invite email via SES |
| `invite-doctor` | `POST /invites/doctor` | Sends invite email via SES |
| `accept-invite` | `POST /invites/accept` | Creates Cognito account for invitee |
| `remove-team-member` | `DELETE /patients/{patientId}/team/{memberId}` | Removes team member, disables Cognito account |
| `post-confirmation` | Cognito trigger | Runs after user confirms signup |
| `sync-observation` | `POST /observations/sync` | Syncs FHIR Observations to HealthLake |
| `bulk-sync` | `POST /observations/bulk-sync` | Batch FHIR sync |
| `presigned-url` | `GET /documents/presigned-url` | Generates S3 upload/download URLs |

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

Replace placeholders in both Amplify config files:

| Placeholder | Example Value |
|---|---|
| `${COGNITO_USER_POOL_ID}` | `ap-south-1_AbCdEfGhI` |
| `${COGNITO_APP_CLIENT_ID}` | `1abc2def3ghi4jkl5mno` |
| `${COGNITO_WEB_DOMAIN}` | `carelog-dev.auth.ap-south-1.amazoncognito.com` |
| `${AWS_REGION}` | `ap-south-1` |
| `${S3_BUCKET_NAME}` | `carelog-v2-dev-documents-316643066568` |

**Files to update:**
- `android/app/src/main/res/raw/amplifyconfiguration.json`
- `ios/CareLog/CareLog/amplifyconfiguration.json`

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

### 9.1 Setup

```bash
firebase login
firebase projects:list
fastlane add_plugin firebase_app_distribution
firebase login:ci   # generates CI token — save it securely
```

### 9.2 Android Distribution

Create `android/fastlane/Fastfile`:

```ruby
default_platform(:android)

platform :android do
  lane :distribute do
    gradle(task: "clean assembleRelease", print_command: false)
    firebase_app_distribution(
      app: "1:YOUR_FIREBASE_APP_ID:android:xxxxxxxx",
      groups: "internal-testers, qa-team",
      release_notes: "Build #{lane_context[SharedValues::BUILD_NUMBER]} - #{Time.now.strftime('%Y-%m-%d %H:%M')}",
      firebase_cli_token: ENV["FIREBASE_TOKEN"],
      apk_path: "app/build/outputs/apk/release/app-release.apk"
    )
  end
end
```

Create `android/fastlane/Appfile`:

```ruby
json_key_file("path/to/google-play-service-account.json")
package_name("com.carelog")
```

Run: `export FIREBASE_TOKEN="your_token" && cd android && fastlane distribute`

### 9.3 iOS Distribution

Create `ios/CareLog/fastlane/Fastfile`:

```ruby
default_platform(:ios)

platform :ios do
  lane :distribute do
    increment_build_number(build_number: Time.now.strftime("%Y%m%d%H%M"))
    build_app(scheme: "CareLog", export_method: "ad-hoc", output_directory: "./build", output_name: "CareLog.ipa")
    firebase_app_distribution(
      app: "1:YOUR_FIREBASE_APP_ID:ios:xxxxxxxx",
      groups: "internal-testers, qa-team",
      release_notes: "Build #{lane_context[SharedValues::BUILD_NUMBER]} - #{Time.now.strftime('%Y-%m-%d %H:%M')}",
      firebase_cli_token: ENV["FIREBASE_TOKEN"],
      ipa_path: "./build/CareLog.ipa"
    )
  end
end
```

Create `ios/CareLog/fastlane/Appfile`:

```ruby
app_identifier("com.carelog.CareLog")
apple_id("your-apple-id@email.com")
team_id("YOUR_TEAM_ID")
```

Requires ad-hoc provisioning: `fastlane match init && fastlane match adhoc`

Run: `export FIREBASE_TOKEN="your_token" && cd ios/CareLog && fastlane distribute`

### 9.4 Managing Testers

```bash
firebase appdistribution:testers:add user@example.com
firebase appdistribution:testers:add --group "internal-testers" user1@example.com user2@example.com
```

Get Firebase App IDs from: **Firebase Console → Project Settings → General → Your apps**.

---

## 10. Troubleshooting

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
| Deploy infrastructure | `cd infrastructure/terraform/environments/dev && terraform apply` |
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

*CareLog Setup and Deployment Guide v2.0 — March 2026*
