# CareLog Setup and Deployment Guide

**Version:** 1.0
**Last Updated:** March 2026

This guide provides step-by-step instructions for setting up the development environment, deploying the backend infrastructure, running the mobile apps in emulators, and distributing builds to testers via Firebase App Distribution.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Repository Setup](#2-repository-setup)
3. [Backend Deployment](#3-backend-deployment)
4. [Android Development](#4-android-development)
5. [iOS Development](#5-ios-development)
6. [Firebase App Distribution](#6-firebase-app-distribution)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Prerequisites

### 1.1 Required Software

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18.x or later | Backend Lambda development |
| npm | 9.x or later | Package management |
| Terraform | 1.5.x or later | Infrastructure as Code |
| AWS CLI | 2.x | AWS service interaction |
| Android Studio | Hedgehog (2023.1.1) or later | Android development |
| Xcode | 15.0 or later | iOS development (macOS only) |
| Java JDK | 17 | Android builds |
| CocoaPods | 1.14.x | iOS dependency management |
| Firebase CLI | Latest | App distribution |
| Fastlane | Latest | Build automation |

### 1.2 Install Prerequisites

#### macOS (using Homebrew)

```bash
# Install Homebrew if not present
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required tools
brew install node@18
brew install terraform
brew install awscli
brew install cocoapods
brew install fastlane

# Install Firebase CLI
npm install -g firebase-tools

# Install Java 17
brew install openjdk@17
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### Android Studio

1. Download from [developer.android.com](https://developer.android.com/studio)
2. Install and open Android Studio
3. Go to **Settings > Languages & Frameworks > Android SDK**
4. Install SDK Platform 34 (Android 14)
5. Install SDK Build-Tools 34.0.0
6. Install Android Emulator and HAXM

#### Xcode (macOS only)

1. Install from Mac App Store
2. Open Xcode and accept the license agreement
3. Install Command Line Tools:
   ```bash
   xcode-select --install
   ```

### 1.3 AWS Account Setup

1. Create an AWS account at [aws.amazon.com](https://aws.amazon.com)
2. Create an IAM user with programmatic access
3. Attach the following policies:
   - `AdministratorAccess` (for initial setup) or create custom policy
4. Configure AWS CLI:
   ```bash
   aws configure
   # Enter your Access Key ID
   # Enter your Secret Access Key
   # Enter default region: ap-south-1 (or your preferred region)
   # Enter default output format: json
   ```

### 1.4 Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **Add Project** and name it `carelog`
3. Enable Google Analytics (optional)
4. Add Android app:
   - Package name: `com.carelog`
   - Download `google-services.json`
5. Add iOS app:
   - Bundle ID: `com.carelog.CareLog`
   - Download `GoogleService-Info.plist`
6. Enable Firebase App Distribution in the console

---

## 2. Repository Setup

### 2.1 Clone the Repository

```bash
git clone https://github.com/subhajitsanyal/matika.git
cd matika
```

### 2.2 Project Structure Overview

```
matika/
├── android/                 # Android app (Kotlin + Jetpack Compose)
├── ios/                     # iOS app (Swift + SwiftUI)
├── backend/                 # Lambda functions and database migrations
├── web-portal/              # Doctor web portal (React + TypeScript)
├── infrastructure/          # Terraform IaC
│   └── terraform/
│       ├── modules/         # Reusable Terraform modules
│       └── environments/    # Environment-specific configs
└── docs/                    # Documentation
```

---

## 3. Backend Deployment

### 3.1 Initialize Terraform

```bash
cd infrastructure/terraform

# Initialize Terraform with backend configuration
terraform init
```

### 3.2 Create Environment Variables

Create a `terraform.tfvars` file for your environment:

```bash
cat > environments/dev/terraform.tfvars << 'EOF'
environment     = "dev"
aws_region      = "ap-south-1"
project_name    = "carelog"

# Cognito settings
cognito_domain_prefix = "carelog-dev"

# Database settings
db_instance_class = "db.t3.micro"
db_username       = "carelog_admin"
# db_password will be prompted or use AWS Secrets Manager

# S3 settings
enable_versioning = true

# HealthLake settings
healthlake_preload_data = false
EOF
```

### 3.3 Deploy Infrastructure

```bash
# Navigate to dev environment
cd environments/dev

# Initialize and plan
terraform init
terraform plan -out=tfplan

# Review the plan, then apply
terraform apply tfplan
```

> **Note:** RDS instance creation takes 5-15 minutes. S3 bucket creation may also take a few minutes due to KMS encryption setup. This is normal.

**Expected resources created:**
- VPC with public/private subnets
- Cognito User Pool with 4 groups (patients, attendants, doctors, relatives)
- API Gateway REST API (including `DELETE /patients/{patientId}` and `DELETE /patients/{patientId}/team/{memberId}` for persona management)
- S3 buckets for documents and access logs
- SQS queues for async processing
- RDS PostgreSQL 15 instance
- Bastion EC2 instance (for SSM port-forwarding to RDS)
- CloudWatch alarms and log groups

### 3.4 Note the Outputs

After deployment, note the important outputs:

```bash
terraform output

# Expected outputs:
# vpc_id = "vpc-xxxxxxxxx"
# public_subnet_ids = ["subnet-xxx", "subnet-xxx"]
# private_subnet_ids = ["subnet-xxx", "subnet-xxx"]
# bastion_instance_id = "i-xxxxxxxxx"
# bastion_ssm_port_forward_command = "aws ssm start-session --target i-xxx ..."
```

### 3.4.1 Troubleshooting Deployment Issues

#### Secrets Manager: "secret already scheduled for deletion"

If a previous deployment was destroyed, secrets enter a deletion waiting period. Force delete and re-apply:

```bash
aws secretsmanager delete-secret --secret-id carelog-dev-db-password --force-delete-without-recovery --region ap-south-1
terraform apply
```

#### IAM Role/Instance Profile: "already exists"

If resources exist from a previous manual or failed deployment, import them into Terraform state. Use quotes around resource addresses containing brackets (required for zsh):

```bash
terraform import 'module.carelog.module.bastion[0].aws_iam_role.bastion' carelog-dev-bastion-role
terraform import 'module.carelog.module.bastion[0].aws_iam_instance_profile.bastion' carelog-dev-bastion-profile
terraform apply
```

#### CloudWatch Log Group: "already exists"

Import the existing log group into state:

```bash
terraform import module.carelog.module.vpc.aws_cloudwatch_log_group.vpc_flow_logs /aws/vpc/carelog-dev-flow-logs
terraform apply
```

#### S3 Bucket: "OperationAborted" / 409 Conflict

S3 bucket names are globally unique. If a previous bucket was recently deleted, S3 may take a few minutes to release the name. Wait 5-10 minutes and retry, or change `s3_bucket_prefix` in the dev config to use a different name.

#### Flyway: "Connection attempt failed" / "Read timed out" (with SSM port-forward active)

If the SSM session shows "Connection accepted" followed by "Connection to destination port failed", the RDS security group is not allowing traffic from the bastion's security group. This commonly happens when:
- Infrastructure was destroyed and re-created (new security group IDs)
- The bastion was created manually outside of Terraform
- The bastion module wasn't included in the last `terraform apply`

**Quick fix (copy-paste):**

```bash
# Find the RDS and bastion security groups, then add the missing inbound rule
RDS_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=*carelog*rds*" --query 'SecurityGroups[0].GroupId' --output text --region ap-south-1)

BASTION_SG=$(aws ec2 describe-instances --instance-ids $(terraform output -raw bastion_instance_id) --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text --region ap-south-1)

echo "RDS SG: $RDS_SG"
echo "Bastion SG: $BASTION_SG"

# Add inbound rule allowing bastion to reach RDS on port 5432
aws ec2 authorize-security-group-ingress \
    --group-id $RDS_SG \
    --protocol tcp \
    --port 5432 \
    --source-group $BASTION_SG \
    --region ap-south-1
```

After adding the rule, restart the SSM port-forward session and retry `flyway migrate`.

**Detailed diagnosis (if the quick fix doesn't work):**

```bash
# 1. Verify the bastion module is in Terraform state
terraform state list | grep bastion
# If empty, run: terraform apply (to create the Terraform-managed bastion)

# 2. Find the RDS security group
aws ec2 describe-security-groups --filters "Name=group-name,Values=*carelog*rds*" --query 'SecurityGroups[*].[GroupId,GroupName]' --output table --region ap-south-1

# 3. Find the bastion's security group
aws ec2 describe-instances --instance-ids BASTION_INSTANCE_ID --query 'Reservations[0].Instances[0].SecurityGroups[*].[GroupId,GroupName]' --output table --region ap-south-1

# 4. Check if the RDS security group allows inbound from the bastion
aws ec2 describe-security-groups --group-ids RDS_SG_ID --query 'SecurityGroups[0].IpPermissions' --output json --region ap-south-1

# 5. If the bastion SG is not listed, add the rule
aws ec2 authorize-security-group-ingress --group-id RDS_SG_ID --protocol tcp --port 5432 --source-group BASTION_SG_ID --region ap-south-1
```

> **Tip:** If using the Terraform-managed bastion (`enable_bastion = true`), the security group rule is created automatically. If you see this error, ensure `terraform apply` completed successfully and the bastion resources are in state.

### 3.5 Connect to RDS via Bastion (Port-Forwarding)

The RDS instance is in a private subnet. The Terraform deployment (with `enable_bastion = true` in the dev config) automatically provisions a bastion EC2 instance with SSM Session Manager access and the necessary security group rules for RDS connectivity.

#### 3.5.1 Prerequisites (One-Time Setup)

```bash
# Install SSM Session Manager plugin
brew install --cask session-manager-plugin

# Install Flyway for database migrations
brew install flyway
```

#### 3.5.2 Get Connection Details

After `terraform apply`, retrieve the bastion instance ID and RDS endpoint:

```bash
cd infrastructure/terraform/environments/dev

# Get the bastion instance ID
terraform output bastion_instance_id

# Get the RDS endpoint
aws rds describe-db-instances --db-instance-identifier carelog-dev --region ap-south-1 --query 'DBInstances[0].Endpoint.Address' --output text
```

#### 3.5.3 Start Port-Forwarding (Terminal 1)

Open a terminal and start the SSM port-forward session. Replace `INSTANCE_ID` and `RDS_ENDPOINT` with values from the previous step:

```bash
aws ssm start-session \
    --target INSTANCE_ID \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters '{"host":["RDS_ENDPOINT"],"portNumber":["5432"],"localPortNumber":["5432"]}' \
    --region ap-south-1
```

You should see:
```
Port 5432 opened for sessionId ...
Waiting for connections...
```

Keep this terminal open.

### 3.6 Run Database Migrations

Open a **second terminal** while port-forwarding is active.

#### 3.6.1 Retrieve Database Credentials

The database password was auto-generated by Terraform and stored in AWS Secrets Manager:

```bash
# View the full credentials JSON
aws secretsmanager get-secret-value --secret-id carelog-dev-db-password --region ap-south-1 --query 'SecretString' --output text

# Extract just the decoded password (handles unicode escapes automatically)
aws secretsmanager get-secret-value --secret-id carelog-dev-db-password --region ap-south-1 --query 'SecretString' --output text | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['password'])"
```

This returns a JSON object with `username`, `password`, `host`, `port`, and `dbname`. The second command extracts and decodes the password directly — this is important because the raw JSON output contains unicode escapes (e.g., `\u0026` = `&`, `\u003c` = `<`, `\u003e` = `>`) that must be decoded before use.

#### 3.6.2 Configure and Run Flyway

```bash
cd backend/database

# Create flyway.conf using credentials from Secrets Manager
# The port-forward makes RDS available at localhost:5432
cat > flyway.conf << 'EOF'
flyway.url=jdbc:postgresql://localhost:5432/carelog_dev
flyway.user=carelog_dev_admin
flyway.password=YOUR_PASSWORD_FROM_SECRETS_MANAGER
flyway.locations=filesystem:./migrations
EOF

# Run migrations
flyway migrate
```

> **Important:** Do not commit `flyway.conf` to version control as it contains database credentials.

### 3.7 Deploy Lambda Functions

```bash
cd ../lambdas

# Install dependencies for each Lambda
for dir in */; do
    if [ -f "$dir/package.json" ]; then
        echo "Installing dependencies for $dir"
        cd "$dir"
        npm install
        cd ..
    fi
done

# Package and deploy (using AWS SAM or Terraform)
# If using Terraform, the Lambdas are deployed with infrastructure
```

#### 3.7.1 New Lambda Functions (Persona Management)

The following Lambdas handle caregiver-managed persona lifecycle:

| Lambda | Route | Description |
|--------|-------|-------------|
| `delete-patient` | `DELETE /patients/{patientId}` | Cascade-deletes a patient and all associated attendants/doctors. Disables their Cognito accounts, deactivates persona_links, cancels pending invites, and sends notification emails. Only the primary caregiver can invoke this. |
| `remove-team-member` | `DELETE /patients/{patientId}/team/{memberId}` | Removes a single attendant or doctor from a patient's care team. Disables their Cognito account and sends a notification email. |

These Lambdas require the following environment variables:
- `DB_SECRET_NAME` — Secrets Manager secret for RDS credentials
- `COGNITO_USER_POOL_ID` — Cognito User Pool ID
- `FROM_EMAIL` — SES verified sender email (defaults to `noreply@carelog.com`)

**Cognito custom attributes:** The `custom:persona_type` and `custom:linked_patient_id` attributes must be added to the Cognito User Pool schema and marked as writable by the app client. Without these, persona-based routing and patient linking will fall back to defaults. To add them:

```bash
aws cognito-idp add-custom-attributes \
    --user-pool-id $COGNITO_USER_POOL_ID \
    --custom-attributes \
        Name=persona_type,AttributeDataType=String,Mutable=true \
        Name=linked_patient_id,AttributeDataType=String,Mutable=true \
    --region $AWS_REGION
```

**Persona flow overview:**
1. Only **caregivers** (persona type: `relative`) can self-register via the app
2. Caregivers create a patient from Settings, which calls `create-patient`
3. Caregivers invite attendants/doctors from Settings, which calls `invite-attendant` / `invite-doctor`
4. Invitees receive an email with a link; accepting calls `accept-invite`, which creates their Cognito account with credentials
5. Caregivers can remove individual team members (`remove-team-member`) or delete the entire patient cascade (`delete-patient`)

### 3.8 Configure Amplify

The Amplify configuration files (`amplifyconfiguration.json`) in both Android and iOS contain placeholders that must be replaced with actual values from your deployment.

#### 3.8.1 Retrieve Placeholder Values

Run these commands to set all values as environment variables. Each variable builds on the previous ones:

```bash
AWS_REGION=ap-south-1

COGNITO_USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region $AWS_REGION --query 'UserPools[?Name==`carelog-dev-users`].Id' --output text)

COGNITO_APP_CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id $COGNITO_USER_POOL_ID --region $AWS_REGION --query 'UserPoolClients[?ClientName==`carelog-mobile-client`].ClientId' --output text)

COGNITO_WEB_DOMAIN=$(aws cognito-idp describe-user-pool --user-pool-id $COGNITO_USER_POOL_ID --region $AWS_REGION --query 'UserPool.Domain' --output text).auth.$AWS_REGION.amazoncognito.com

S3_BUCKET_NAME=$(aws s3 ls | grep carelog | grep documents | awk '{print $3}')

API_GATEWAY_ID=$(aws apigateway get-rest-apis --region $AWS_REGION --query 'items[?name==`carelog-dev-api`].id' --output text)
API_GATEWAY_URL=https://$API_GATEWAY_ID.execute-api.$AWS_REGION.amazonaws.com/dev
```

Verify all values are set:

```bash
echo "COGNITO_USER_POOL_ID:  $COGNITO_USER_POOL_ID"
echo "COGNITO_APP_CLIENT_ID: $COGNITO_APP_CLIENT_ID"
echo "COGNITO_WEB_DOMAIN:    $COGNITO_WEB_DOMAIN"
echo "AWS_REGION:            $AWS_REGION"
echo "S3_BUCKET_NAME:        $S3_BUCKET_NAME"
echo "API_GATEWAY_URL:       $API_GATEWAY_URL"
```

#### 3.8.2 Update Configuration Files

Replace the placeholders in both files:

| Placeholder | Description | Example |
|---|---|---|
| `${COGNITO_USER_POOL_ID}` | Cognito User Pool ID | `ap-south-1_AbCdEfGhI` |
| `${COGNITO_APP_CLIENT_ID}` | Mobile app client ID | `1abc2def3ghi4jkl5mno` |
| `${COGNITO_WEB_DOMAIN}` | Cognito hosted UI domain | `carelog-dev.auth.ap-south-1.amazoncognito.com` |
| `${AWS_REGION}` | AWS region | `ap-south-1` |
| `${S3_BUCKET_NAME}` (iOS only) | Documents S3 bucket | `carelog-v2-dev-documents-316643066568` |

**Files to update:**
- **Android:** `android/app/src/main/res/raw/amplifyconfiguration.json`
- **iOS:** `ios/CareLog/CareLog/amplifyconfiguration.json`

---

## 4. Android Development

### 4.1 Open Project in Android Studio

1. Open Android Studio
2. Select **File > Open**
3. Navigate to `matika/android` and click **Open**
4. Wait for Gradle sync to complete

### 4.2 Add Firebase Configuration

1. Copy `google-services.json` to `android/app/`
2. Verify Firebase dependencies in `build.gradle.kts`

### 4.3 Create an Android Emulator

1. Go to **Tools > Device Manager**
2. Click **Create Device**
3. Select **Pixel 6** (or similar)
4. Select **API 34** system image
5. Name it `Pixel_6_API_34`
6. Click **Finish**

### 4.4 Run the App in Emulator

**Using Android Studio:**

1. Select the emulator from the device dropdown
2. Click the **Run** button (green play icon)
3. Wait for the app to build and launch

**Using Command Line:**

```bash
cd android

# List available emulators
emulator -list-avds

# Start emulator in background
emulator -avd Pixel_6_API_34 &

# Build and install debug APK
./gradlew installDebug

# Launch the app
adb shell am start -n com.carelog/.ui.MainActivity
```

### 4.5 Build Debug APK

```bash
cd android
./gradlew assembleDebug

# APK location:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### 4.6 Build Release APK

```bash
# Create keystore (first time only)
keytool -genkey -v -keystore carelog-release.keystore \
    -alias carelog -keyalg RSA -keysize 2048 -validity 10000

# Create signing config in local.properties
cat >> local.properties << 'EOF'
RELEASE_STORE_FILE=../carelog-release.keystore
RELEASE_STORE_PASSWORD=your_keystore_password
RELEASE_KEY_ALIAS=carelog
RELEASE_KEY_PASSWORD=your_key_password
EOF

# Build release APK
./gradlew assembleRelease

# APK location:
# android/app/build/outputs/apk/release/app-release.apk
```

### 4.7 Run Tests

```bash
# Unit tests
./gradlew test

# Instrumentation tests (requires emulator)
./gradlew connectedAndroidTest
```

---

## 5. iOS Development

### 5.1 Install Dependencies

```bash
cd ios/CareLog

# Install CocoaPods dependencies (if using Pods)
pod install

# Or resolve Swift Package Manager dependencies
# Open Xcode and let it resolve packages automatically
```

### 5.2 Open Project in Xcode

```bash
# Open the Xcode project
open CareLog.xcodeproj

# Or if using CocoaPods workspace
open CareLog.xcworkspace
```

### 5.3 Add Firebase Configuration

1. Copy `GoogleService-Info.plist` to `ios/CareLog/CareLog/`
2. In Xcode, right-click on the CareLog group and select **Add Files to "CareLog"**
3. Select `GoogleService-Info.plist`
4. Ensure "Copy items if needed" is checked

### 5.4 Configure Signing

1. In Xcode, select the **CareLog** project in the navigator
2. Select the **CareLog** target
3. Go to **Signing & Capabilities**
4. Select your **Team** from the dropdown
5. Ensure **Automatically manage signing** is checked
6. Fix any signing issues that appear

### 5.5 Create an iOS Simulator

1. Go to **Window > Devices and Simulators**
2. Click the **Simulators** tab
3. Click **+** to add a new simulator
4. Select **iPhone 15 Pro** and **iOS 17.0**
5. Click **Create**

### 5.6 Run the App in Simulator

**Using Xcode:**

1. Select the simulator from the device dropdown (top toolbar)
2. Click the **Run** button (play icon) or press `Cmd + R`
3. Wait for the app to build and launch

**Using Command Line:**

```bash
cd ios/CareLog

# List available simulators
xcrun simctl list devices

# Boot a simulator
xcrun simctl boot "iPhone 15 Pro"

# Build and run
xcodebuild -scheme CareLog -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build

# Install on simulator
xcrun simctl install booted build/Debug-iphonesimulator/CareLog.app

# Launch app
xcrun simctl launch booted com.carelog.CareLog
```

### 5.7 Build for Testing

```bash
cd ios/CareLog

# Build for testing (simulator)
xcodebuild -scheme CareLog \
    -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
    -configuration Debug \
    build-for-testing

# Build archive for device testing
xcodebuild -scheme CareLog \
    -configuration Release \
    -archivePath build/CareLog.xcarchive \
    archive
```

### 5.8 Run Tests

```bash
# Run unit tests
xcodebuild test \
    -scheme CareLog \
    -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
    -resultBundlePath TestResults
```

---

## 6. Firebase App Distribution

Firebase App Distribution allows you to distribute pre-release builds to testers without going through the App Store or Play Store.

### 6.1 Install and Configure Firebase CLI

```bash
# Install Firebase CLI (if not already installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Verify login
firebase projects:list
```

### 6.2 Install Fastlane Firebase Plugin

```bash
# Install the Firebase App Distribution plugin for Fastlane
fastlane add_plugin firebase_app_distribution
```

### 6.3 Configure Android Distribution

#### Create Fastfile

```bash
cd android
mkdir -p fastlane
cat > fastlane/Fastfile << 'EOF'
default_platform(:android)

platform :android do
  desc "Build and distribute to Firebase App Distribution"
  lane :distribute do
    # Build the release APK
    gradle(
      task: "clean assembleRelease",
      print_command: false
    )

    # Upload to Firebase App Distribution
    firebase_app_distribution(
      app: "1:YOUR_FIREBASE_APP_ID:android:xxxxxxxx",
      groups: "internal-testers, qa-team",
      release_notes: "Build #{lane_context[SharedValues::BUILD_NUMBER]} - #{Time.now.strftime('%Y-%m-%d %H:%M')}",
      firebase_cli_token: ENV["FIREBASE_TOKEN"],
      apk_path: "app/build/outputs/apk/release/app-release.apk"
    )
  end

  desc "Build debug APK for local testing"
  lane :build_debug do
    gradle(
      task: "clean assembleDebug",
      print_command: false
    )
  end
end
EOF
```

#### Create Appfile

```bash
cat > fastlane/Appfile << 'EOF'
json_key_file("path/to/google-play-service-account.json")
package_name("com.carelog")
EOF
```

#### Get Firebase App ID

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Go to **Project Settings > General**
4. Under "Your apps", find the Android app
5. Copy the **App ID** (format: `1:xxxx:android:xxxx`)

#### Generate Firebase CI Token

```bash
firebase login:ci
# This will generate a token for CI/CD use
# Save this token securely
```

#### Run Distribution

```bash
cd android

# Set Firebase token
export FIREBASE_TOKEN="your_firebase_ci_token"

# Run distribution
fastlane distribute
```

### 6.4 Configure iOS Distribution

#### Create Fastfile

```bash
cd ios/CareLog
mkdir -p fastlane
cat > fastlane/Fastfile << 'EOF'
default_platform(:ios)

platform :ios do
  desc "Build and distribute to Firebase App Distribution"
  lane :distribute do
    # Increment build number
    increment_build_number(
      build_number: Time.now.strftime("%Y%m%d%H%M")
    )

    # Build the app
    build_app(
      scheme: "CareLog",
      export_method: "ad-hoc",
      output_directory: "./build",
      output_name: "CareLog.ipa"
    )

    # Upload to Firebase App Distribution
    firebase_app_distribution(
      app: "1:YOUR_FIREBASE_APP_ID:ios:xxxxxxxx",
      groups: "internal-testers, qa-team",
      release_notes: "Build #{lane_context[SharedValues::BUILD_NUMBER]} - #{Time.now.strftime('%Y-%m-%d %H:%M')}",
      firebase_cli_token: ENV["FIREBASE_TOKEN"],
      ipa_path: "./build/CareLog.ipa"
    )
  end

  desc "Build for simulator testing"
  lane :build_simulator do
    build_app(
      scheme: "CareLog",
      destination: "generic/platform=iOS Simulator",
      configuration: "Debug",
      derived_data_path: "./build"
    )
  end
end
EOF
```

#### Create Appfile

```bash
cat > fastlane/Appfile << 'EOF'
app_identifier("com.carelog.CareLog")
apple_id("your-apple-id@email.com")
team_id("YOUR_TEAM_ID")
EOF
```

#### Setup Code Signing for Ad-Hoc Distribution

```bash
# Initialize match for code signing
fastlane match init

# Create ad-hoc provisioning profile
fastlane match adhoc
```

#### Run Distribution

```bash
cd ios/CareLog

# Set Firebase token
export FIREBASE_TOKEN="your_firebase_ci_token"

# Run distribution
fastlane distribute
```

### 6.5 Add Testers to Firebase

#### Using Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Go to **App Distribution** in the left sidebar
4. Click **Testers & Groups**
5. Click **Add group** to create groups:
   - `internal-testers` - Development team
   - `qa-team` - QA engineers
   - `beta-testers` - External beta users
6. Add tester emails to each group

#### Using Firebase CLI

```bash
# Add a tester
firebase appdistribution:testers:add user@example.com

# Add testers to a group
firebase appdistribution:testers:add \
    --group "internal-testers" \
    user1@example.com user2@example.com
```

### 6.6 Notify Testers

After uploading a build, Firebase automatically sends email notifications to testers. You can also manually notify:

#### Using Firebase Console

1. Go to **App Distribution**
2. Select the release
3. Click **Notify testers**
4. Select groups or individual testers
5. Add optional release notes
6. Click **Send**

#### Using Fastlane (Automatic)

The `firebase_app_distribution` action in your Fastfile automatically notifies testers in the specified groups when a new build is uploaded.

### 6.7 Complete Distribution Workflow

Here's a complete script to build and distribute both platforms:

```bash
#!/bin/bash
# distribute.sh - Build and distribute CareLog to testers

set -e

# Configuration
export FIREBASE_TOKEN="your_firebase_ci_token"

echo "=========================================="
echo "CareLog Distribution Script"
echo "=========================================="

# Get release notes from user
read -p "Enter release notes: " RELEASE_NOTES
export RELEASE_NOTES

# Distribute Android
echo ""
echo "Building and distributing Android..."
cd android
fastlane distribute
cd ..

# Distribute iOS (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo ""
    echo "Building and distributing iOS..."
    cd ios/CareLog
    fastlane distribute
    cd ../..
else
    echo "Skipping iOS (not on macOS)"
fi

echo ""
echo "=========================================="
echo "Distribution complete!"
echo "Testers will receive email notifications."
echo "=========================================="
```

Make the script executable:

```bash
chmod +x distribute.sh
./distribute.sh
```

---

## 7. Troubleshooting

### 7.1 Common Android Issues

#### Gradle Sync Failed

```bash
# Clear Gradle cache
cd android
./gradlew clean
rm -rf ~/.gradle/caches/

# Sync again in Android Studio
```

#### Emulator Not Starting

```bash
# Check HAXM/KVM status
# macOS
kextstat | grep intel

# Cold boot the emulator
emulator -avd Pixel_6_API_34 -no-snapshot-load
```

#### Build Variant Issues

```bash
# List all build variants
./gradlew tasks --group="build"

# Build specific variant
./gradlew assembleDevDebug
```

### 7.2 Common iOS Issues

#### Pod Install Fails

```bash
# Update CocoaPods
sudo gem install cocoapods

# Clear pod cache
pod cache clean --all
rm -rf Pods Podfile.lock
pod install
```

#### Swift Package Resolution Fails

```bash
# Clear SPM cache
rm -rf ~/Library/Caches/org.swift.swiftpm
rm -rf ~/Library/Developer/Xcode/DerivedData

# Reset packages in Xcode
# File > Packages > Reset Package Caches
```

#### Signing Issues

1. Ensure Apple Developer account is active
2. Check that certificates are valid in Keychain
3. Revoke and recreate provisioning profiles if needed

### 7.3 Common Backend Issues

#### Terraform State Lock

```bash
# Force unlock (use with caution)
terraform force-unlock LOCK_ID
```

#### Lambda Deployment Fails

```bash
# Check Lambda logs
aws logs tail /aws/lambda/carelog-dev-function-name --follow

# Update Lambda code manually
aws lambda update-function-code \
    --function-name carelog-dev-function-name \
    --zip-file fileb://function.zip
```

#### Database Connection Issues

```bash
# Test RDS connectivity
psql -h YOUR_RDS_ENDPOINT -U carelog_admin -d carelog

# Check security group rules
aws ec2 describe-security-groups --group-ids sg-xxxxxxxx
```

### 7.4 Firebase Distribution Issues

#### Token Expired

```bash
# Regenerate CI token
firebase login:ci
# Update FIREBASE_TOKEN in your environment
```

#### Build Not Appearing for Testers

1. Verify tester email is correct
2. Check tester is in the specified group
3. Ensure app ID matches in Fastfile
4. Check Firebase Console for upload errors

---

## Quick Reference Commands

### Android

```bash
# Build debug
./gradlew assembleDebug

# Build release
./gradlew assembleRelease

# Run tests
./gradlew test

# Install on device
./gradlew installDebug

# Distribute
fastlane distribute
```

### iOS

```bash
# Build for simulator
xcodebuild -scheme CareLog -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build

# Run tests
xcodebuild test -scheme CareLog -destination 'platform=iOS Simulator,name=iPhone 15 Pro'

# Distribute
fastlane distribute
```

### Backend

```bash
# Deploy infrastructure
cd infrastructure/terraform/environments/dev
terraform apply

# Run migrations
cd backend/database
flyway migrate

# View logs
aws logs tail /aws/lambda/carelog-dev-sync-observation --follow
```

---

*CareLog Setup and Deployment Guide v1.0 — March 2026*
