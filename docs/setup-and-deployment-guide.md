# CareLog Setup and Deployment Guide

**Version:** 3.0
**Last Updated:** April 2026

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
| Python | 3.11+ | Mac Mini model services |

### 1.2 Install (macOS)

```bash
brew install node@20 terraform awscli cocoapods fastlane openjdk@17 python@3.11
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

You need `AdministratorAccess` for initial setup, or a scoped policy covering VPC, Cognito, API Gateway, RDS, S3, SQS, SNS, EC2, IAM, KMS, CloudWatch, CloudTrail, EventBridge, and Secrets Manager.

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

Add to your `terraform.tfvars` (see section 3.2):

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

AWS reviews and approves within 24-48 hours.

### 1.5 Firebase Project Setup

1. Create project `carelog` at [Firebase Console](https://console.firebase.google.com)
2. Add Android app (`com.carelog`) -> download `google-services.json`
3. Add iOS app (`com.carelog.CareLog`) -> download `GoogleService-Info.plist`
4. Enable Firebase App Distribution
5. Enable Firebase Cloud Messaging (FCM) for push notifications

---

## 2. Architecture Overview

CareLog v3.0 introduces a **conversational, voice-first** health monitoring system with 4 deployment boundaries:

```
                          +-----------------+
                          |   Mac Mini M4   |
                          | (LAN, mDNS)    |
                          |                 |
                          | STT  :8001      |
                          | LLM  :8002      |
          WiFi/LAN        | TTS  :8003      |
    +-------------------->| Vision :8004    |
    |                     | Health :8000    |
    |                     +-----------------+
    |
+---+----------+          +-----------------+       +------------------+
| Android App  |---HTTPS->| API Gateway     |------>| Lambda Functions |
| (Patient /   |          |                 |       +--------+---------+
|  Caregiver)  |          +-----------------+                |
+--------------+                                    +--------v---------+
                                                    | RDS PostgreSQL   |
+--------------+          +-----------------+       | S3 (FHIR + Raw)  |
| Web Portal   |---HTTPS->| API Gateway     |       | SQS / SNS        |
| (Doctor)     |          |                 |       +------------------+
+--------------+          +-----------------+
```

**Key concepts:**
- **Mac Mini M4** runs AI model services (STT, LLM, TTS, Vision) on the local network, discovered via mDNS (`_carelog._tcp`)
- **Android app** uses dual networking: LAN for inference (Mac Mini), HTTPS for persistence (AWS)
- **Cognito groups**: `patients`, `caregivers`, `doctors`, plus legacy `attendants` and `relatives` (kept for backward compatibility; post-confirmation Lambda maps all three to `caregivers` group)
- **3 languages**: English, Hindi, Bengali with code-mixing support
- **Latency target**: P95 < 2 seconds end-to-end (STT + LLM + TTS)

---

## 3. Clone the Repository

```bash
git clone git@github.com:subhajitsanyal/matika.git
cd matika
```

---

## 4. Mac Mini Setup

The Mac Mini M4 hosts 5 FastAPI model services that handle speech-to-text, language model inference, text-to-speech, and vision extraction. The Android app discovers the Mac Mini via mDNS on the local network.

### 4.1 Directory Structure

After provisioning, the Mac Mini will have:

```
/opt/carelog/
├── models/
│   ├── whisper-large-v3.bin          # STT model
│   ├── qwen-2.5-7b-q4.gguf          # LLM model
│   ├── qwen-vl-7b-q4.gguf           # Vision model
│   ├── piper-en.onnx                 # TTS English voice
│   ├── piper-hi.onnx                 # TTS Hindi voice
│   ├── piper-bn.onnx                 # TTS Bengali voice
│   ├── current-stt -> whisper-large-v3.bin
│   ├── current-llm -> qwen-2.5-7b-q4.gguf
│   ├── current-vision -> qwen-vl-7b-q4.gguf
│   └── previous/                      # Rollback versions
├── services/                          # Python FastAPI service files
├── venv/                              # Python virtual environment
├── logs/                              # Service logs (rotated)
└── tmp/                               # Ephemeral session data (auto-cleaned)
```

### 4.2 Provisioning

#### Option A: Download models first (recommended for dev/testing)

Use the standalone download script to fetch models from Hugging Face before provisioning:

```bash
cd mac-mini/scripts
sudo mkdir -p /opt/carelog/models
./download-models.sh
```

This downloads (~13 GB total):
- **STT**: Whisper Large V3 from `Systran/faster-whisper-large-v3` (~3 GB)
- **LLM**: Qwen 2.5 7B Instruct Q4_K_M from `Qwen/Qwen2.5-7B-Instruct-GGUF` (~4.7 GB)
- **Vision**: Qwen2-VL 7B Q4_K_M from `Qwen/Qwen2-VL-7B-Instruct-GGUF` (~4.7 GB)
- **TTS**: Piper voices for English and Hindi from `rhasspy/piper-voices` (~120 MB)

> **Note:** Bengali TTS is not yet available in Piper. The service will gracefully return 503 for Bengali TTS requests.

The script supports resume (`curl -C -`), so it's safe to re-run if interrupted.

#### Option B: Full provisioning (production)

Run the provisioning script (idempotent — safe to re-run):

```bash
cd mac-mini/deploy
sudo ./provision.sh
```

This script:
1. Installs macOS updates and Xcode CLI tools
2. Installs Homebrew and Python 3.11
3. Creates the `/opt/carelog` directory structure
4. Sets up a Python virtual environment with dependencies
5. Downloads all model weights and creates symlinks
6. Copies service files from `mac-mini/services/`
7. Installs launchd plists for all 5 services
8. Registers mDNS service (`_carelog._tcp` on port 8000)
9. Runs security hardening (firewall, FileVault check, SSH hardening)
10. Verifies all services respond to health checks

### 4.3 Service Ports

| Service | Port | Endpoint | Purpose |
|---------|------|----------|---------|
| Health Aggregator | 8000 | `GET /health` | Aggregated health status + mDNS advertisement |
| STT (Whisper) | 8001 | `POST /transcribe`, `WS /transcribe/stream` | Speech-to-text |
| LLM (Qwen 2.5) | 8002 | Session CRUD + `/sessions/{id}/turn` | Conversation engine |
| TTS (Piper) | 8003 | `POST /synthesize`, `WS /synthesize/stream` | Text-to-speech |
| Vision (Qwen-VL) | 8004 | `POST /extract` | Photo-based reading extraction |

### 4.4 Verify Services

```bash
# Check all services via health aggregator
curl http://localhost:8000/health

# Expected response:
# {
#   "status": "healthy",
#   "services": {
#     "stt": { "status": "healthy", "model": "whisper-large-v3", ... },
#     "llm": { "status": "healthy", "model": "qwen-2.5-7b", ... },
#     "tts": { "status": "healthy", "voices": ["en", "hi", "bn"], ... },
#     "vision": { "status": "healthy", ... }
#   }
# }

# Check individual services
curl http://localhost:8001/health   # STT
curl http://localhost:8002/health   # LLM
curl http://localhost:8003/health   # TTS
curl http://localhost:8004/health   # Vision
```

### 4.5 Managing Services

Services are managed via launchd:

```bash
# View service status
sudo launchctl list | grep carelog

# Stop a service
sudo launchctl unload /Library/LaunchDaemons/com.carelog.llm.plist

# Start a service
sudo launchctl load /Library/LaunchDaemons/com.carelog.llm.plist

# View logs
tail -f /opt/carelog/logs/llm.log
tail -f /opt/carelog/logs/llm.error.log
```

### 4.6 Model Updates

To update a model without downtime:

```bash
cd mac-mini/deploy
sudo ./update-model.sh stt https://your-host/whisper-large-v3-new.bin
sudo ./update-model.sh llm https://your-host/qwen-2.5-7b-q4-new.gguf
```

The script downloads to a staging area, swaps the symlink, restarts the service, verifies health, and auto-rolls back on failure.

### 4.7 Security Hardening

The provisioning script automatically runs security hardening. To run individually:

```bash
# Firewall: allow only ports 8000-8004 + mDNS
sudo mac-mini/deploy/security/firewall-setup.sh

# FileVault: check/enable disk encryption
sudo mac-mini/deploy/security/filevault-check.sh

# SSH: restrict to key-only, LAN-only
sudo mac-mini/deploy/security/harden-ssh.sh
```

### 4.8 Monitoring

Cron jobs are installed by the provisioning script:

| Job | Schedule | Script | Purpose |
|-----|----------|--------|---------|
| Health logging | Every 5 min | `monitoring/health-cron.sh` | Log memory/disk/service status |
| Tmp cleanup | Every hour | `monitoring/cleanup-tmp.sh` | Remove stale `/opt/carelog/tmp/` directories |
| Log rotation | Daily | `monitoring/log-rotate.conf` | Rotate service logs (7 day retention) |

### 4.9 Pilot Deployment

For deploying Mac Minis to patient households:

```bash
cd mac-mini/deploy

# Set up a household-specific Mac Mini
sudo ./pilot-setup.sh --hostname "household-kumar" --wifi-ssid "KumarHome" --wifi-pass "password"

# Run smoke test
./pilot-smoke-test.sh
```

The pilot setup script configures hostname, WiFi, runs full provisioning, and verifies all services.

---

## 5. Backend Deployment

### 5.0 Clean Up Previous Deployments

If you have infrastructure from a prior deployment, tear it down first to avoid state conflicts, orphaned resources, and naming collisions.

#### 5.0.1 Destroy Terraform-Managed Resources

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform destroy
```

Review the plan and confirm. RDS deletion takes several minutes.

#### 5.0.2 Clean Up Resources That Survive `terraform destroy`

Some resources have deletion protection or deferred deletion. Clean them up manually:

```bash
# Force-delete Secrets Manager secrets (otherwise they wait 7-30 days)
aws secretsmanager delete-secret --secret-id carelog-dev-db-password \
    --force-delete-without-recovery --region ap-south-1

# Delete any leftover CloudWatch log groups
for prefix in /aws/vpc/carelog-dev /aws/apigateway/carelog-dev /aws/lambda/carelog-dev; do
    for lg in $(aws logs describe-log-groups --log-group-name-prefix "$prefix" \
        --query 'logGroups[].logGroupName' --output text --region ap-south-1); do
        echo "Deleting $lg"
        aws logs delete-log-group --log-group-name "$lg" --region ap-south-1
    done
done
```

#### 5.0.3 Clean Up Cognito Users and Domain

If you want a completely clean slate with no dangling users or roles from before:

```bash
REGION="ap-south-1"

# Find the Cognito user pool (if it survived destroy or was created outside TF)
POOL_ID=$(aws cognito-idp list-user-pools --max-results 20 --region $REGION \
    --query 'UserPools[?contains(Name, `carelog`)].Id' --output text)

if [ -n "$POOL_ID" ]; then
    echo "Found Cognito pool: $POOL_ID"

    # Delete all users
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

    # Delete custom domain if one exists
    DOMAIN=$(aws cognito-idp describe-user-pool --user-pool-id $POOL_ID \
        --region $REGION --query 'UserPool.Domain' --output text 2>/dev/null)
    if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "None" ]; then
        echo "Deleting Cognito domain: $DOMAIN"
        aws cognito-idp delete-user-pool-domain \
            --user-pool-id $POOL_ID --domain "$DOMAIN" --region $REGION
    fi

    # Delete the user pool itself (if Terraform didn't)
    aws cognito-idp delete-user-pool --user-pool-id $POOL_ID --region $REGION 2>/dev/null && \
        echo "Deleted user pool $POOL_ID" || echo "Pool already deleted by Terraform"
fi
```

#### 5.0.4 Verify Clean State

```bash
REGION="ap-south-1"

echo "=== Cognito pools ==="
aws cognito-idp list-user-pools --max-results 20 --region $REGION \
    --query 'UserPools[?contains(Name, `carelog`)].{Name:Name,Id:Id}' --output table

echo "=== Secrets Manager ==="
aws secretsmanager list-secrets --region $REGION \
    --query 'SecretList[?contains(Name, `carelog`)].{Name:Name,DeletedDate:DeletedDate}' --output table

echo "=== CloudWatch log groups ==="
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/carelog-dev \
    --query 'logGroups[].logGroupName' --output text --region $REGION

echo "=== S3 buckets ==="
aws s3 ls | grep carelog

echo "=== IAM roles ==="
aws iam list-roles --query 'Roles[?contains(RoleName, `carelog`)].RoleName' --output text
```

All of the above should return empty. If any IAM roles remain, delete them:

```bash
for role in $(aws iam list-roles --query 'Roles[?contains(RoleName, `carelog`)].RoleName' --output text); do
    echo "Cleaning up IAM role: $role"
    # Detach policies first
    for policy in $(aws iam list-attached-role-policies --role-name $role --query 'AttachedPolicies[].PolicyArn' --output text); do
        aws iam detach-role-policy --role-name $role --policy-arn $policy
    done
    for policy in $(aws iam list-role-policies --role-name $role --query 'PolicyNames[]' --output text); do
        aws iam delete-role-policy --role-name $role --policy-name $policy
    done
    # Remove from instance profiles
    for profile in $(aws iam list-instance-profiles-for-role --role-name $role --query 'InstanceProfiles[].InstanceProfileName' --output text); do
        aws iam remove-role-from-instance-profile --instance-profile-name $profile --role-name $role
        aws iam delete-instance-profile --instance-profile-name $profile
    done
    aws iam delete-role --role-name $role
done
```

#### 5.0.5 Reset Local Terraform State

```bash
cd infrastructure/terraform/environments/dev
rm -rf .terraform terraform.tfstate terraform.tfstate.backup tfplan .terraform.lock.hcl
```

You're now ready for a clean deployment.

### 5.1 What Terraform Creates

A single `terraform apply` deploys everything:

| Resource | Details |
|----------|---------|
| VPC | Public/private subnets, NAT gateways, security groups |
| Cognito | User Pool with 5 groups (`patients`, `attendants`, `relatives`, `caregivers`, `doctors`), OAuth clients, post-confirmation Lambda trigger |
| API Gateway | REST API with Cognito authorizer, Lambda proxy integrations (30+ routes) |
| Lambda | 28 functions deployed via Terraform (see section 7.4 for full list) |
| RDS | PostgreSQL 15 in private subnet, encrypted, password in Secrets Manager |
| S3 | Documents bucket + FHIR observations bucket + raw interactions bucket (all KMS encrypted, lifecycle rules) + access logs bucket |
| SQS | Document processing queue + alerts queue (both with DLQs) |
| SNS | Push notification platform apps (APNs, FCM) + alert topics + operator alert topic |
| Bastion | EC2 instance for SSM port-forwarding to RDS (dev only) |
| EventBridge | Scheduled rules for deadline checks (15 min) and missed measurements (1 hour) |
| CloudWatch | 6 alarms (Lambda errors, API 5xx, SQS DLQ, RDS CPU/storage) + operational dashboard |

### 5.2 Configure SES Email (Optional)

All infrastructure variables (VPC, DB, feature flags, etc.) are already configured in each environment's `main.tf`. The only optional configuration is SES email for Cognito verification emails.

Without SES, Cognito uses its built-in email sender (50 emails/day limit, generic sender). To use SES, create a `terraform.tfvars` file (gitignored):

```bash
cd infrastructure/terraform/environments/dev
```

```hcl
ses_email_arn  = "arn:aws:ses:ap-south-1:YOUR_ACCOUNT_ID:identity/your-email@domain.com"
ses_from_email = "CareLog <your-email@domain.com>"
```

> **Note:** The SES identity must already be verified (see section 1.4). If you skip this, Cognito will still work with its default email — you can add SES later.

### 5.3 Install Lambda Dependencies (before Terraform)

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

### 5.4 Deploy Infrastructure + Lambdas

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

This deploys everything in one step: VPC, Cognito, RDS, S3, SQS, SNS, API Gateway, all Lambda functions, EventBridge rules, CloudWatch alarms, and the Cognito post-confirmation trigger. RDS creation takes 5-15 minutes on first deploy; Lambda functions take 2-7 minutes each (VPC ENI setup).

### 5.5 Note the Outputs

```bash
terraform output
```

Key outputs: `vpc_id`, `bastion_instance_id`, `public_subnet_ids`, `private_subnet_ids`, `api_gateway_url`, `raw_interactions_bucket_name`, `operator_alerts_topic_arn`.

### 5.6 Update App Configs After Deploy

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
export FIREBASE_ANDROID_APP_ID="1:191872106923:android:63245761468592e0d612ee"
export FIREBASE_TOKEN="<your-firebase-ci-token>"   # from: firebase login:ci
./gradlew assembleDebug
bundle exec fastlane distribute_debug
```

> **Important:** Never hardcode API Gateway IDs in source files. Always use `update-app-config.sh`
> after infrastructure changes. The API Gateway ID changes on every fresh `terraform apply`.

### 5.7 Troubleshooting Deployment Issues

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

**S3 Bucket: 409 Conflict** — S3 names are globally unique. If recently deleted, wait 5-10 minutes or change `s3_bucket_prefix`.

**SQS Queue: "QueueAlreadyExists" with different KmsMasterKeyId**

SQS queues survive `terraform destroy` if they were created with a KMS key that has since been deleted. Delete the orphaned queues and KMS alias, then re-apply:

```bash
REGION="ap-south-1"

# Delete KMS aliases
for alias in $(aws kms list-aliases --region $REGION \
    --query 'Aliases[?contains(AliasName, `carelog`)].AliasName' --output text); do
    aws kms delete-alias --alias-name "$alias" --region $REGION
done

# Delete SQS queues
for url in $(aws sqs list-queues --queue-name-prefix carelog --region $REGION \
    --query 'QueueUrls[]' --output text 2>/dev/null); do
    aws sqs delete-queue --queue-url "$url" --region $REGION
done

# SQS queues take 60 seconds to fully delete
sleep 60
terraform apply
```

**EventBridge Rule: "can't be deleted since it has targets"**

EventBridge rules must have their targets removed before deletion. This can happen if `terraform destroy` tries to delete the rule before removing its targets:

```bash
REGION="ap-south-1"
for rule in $(aws events list-rules --name-prefix carelog --region $REGION \
    --query 'Rules[].Name' --output text); do
    # Remove all targets
    for target in $(aws events list-targets-by-rule --rule "$rule" --region $REGION \
        --query 'Targets[].Id' --output text); do
        aws events remove-targets --rule "$rule" --ids "$target" --region $REGION
    done
    # Delete the rule
    aws events delete-rule --name "$rule" --region $REGION
done
terraform destroy  # or terraform apply
```

**Lambda functions still exist after `terraform destroy`**

Lambdas deployed or updated via `aws lambda update-function-code` (AWS CLI) may survive `terraform destroy` because their state drifted from Terraform. Delete them manually:

```bash
REGION="ap-south-1"
for fn in $(aws lambda list-functions --region $REGION \
    --query 'Functions[?starts_with(FunctionName, `carelog`)].FunctionName' --output text); do
    aws lambda delete-function --function-name "$fn" --region $REGION
done
```

**CloudWatch Log Group: "ResourceAlreadyExistsException"**

Log groups for VPC flow logs or API Gateway access logs may survive `terraform destroy`. Import them into state:

```bash
# VPC flow logs
terraform import module.carelog.module.vpc.aws_cloudwatch_log_group.vpc_flow_logs /aws/vpc/carelog-dev-flow-logs

# API Gateway access logs
terraform import 'module.carelog.module.api_gateway.aws_cloudwatch_log_group.api_access_logs' '/aws/api-gateway/carelog-dev'

terraform apply
```

**RDS DB Subnet Group / Parameter Group: "already exists"**

These lightweight RDS resources can survive destroy. Import them:

```bash
terraform import 'module.carelog.module.rds.aws_db_subnet_group.main' 'carelog-dev-db-subnet-group'
terraform import 'module.carelog.module.rds.aws_db_parameter_group.main' 'carelog-dev-pg-params'
terraform apply
```

**SQS Event Source Mapping: "does not have permissions to call ReceiveMessage"**

The Lambda IAM role hasn't finished propagating when Terraform tries to create the SQS event source mapping. Simply re-run `terraform apply` — the role will be ready on the second attempt. If it persists, verify the role has the SQS policy:

```bash
aws iam list-attached-role-policies --role-name carelog-dev-lambda-rds-sqs
```

**"Resource already managed by Terraform" during import**

If Terraform says the resource is already in state but the cloud resource doesn't match, remove the stale state entry first:

```bash
terraform state rm module.carelog.module.vpc.aws_cloudwatch_log_group.vpc_flow_logs
terraform import module.carelog.module.vpc.aws_cloudwatch_log_group.vpc_flow_logs /aws/vpc/carelog-dev-flow-logs
terraform apply
```

**General approach for "already exists" errors**

When `terraform apply` fails because a resource already exists in AWS but isn't in Terraform state, the fix is always the same pattern:

1. Find the resource address from the error (e.g., `module.carelog.module.rds.aws_db_subnet_group.main`)
2. Find the resource ID from the error (e.g., `carelog-dev-db-subnet-group`)
3. Import: `terraform import '<address>' '<id>'`
4. Re-apply: `terraform apply`

---

## 6. Database Setup

### 6.1 One-Time Prerequisites

```bash
brew install --cask session-manager-plugin
brew install flyway
```

### 6.2 Start Port-Forwarding (Terminal 1)

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

### 6.3 Run Migrations (Terminal 2)

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

The V004 migration (`V004__conversational_system.sql`) renames the `persona_type` enum value `relative` to `caregiver`, creates 7 new tables, seeds initial data, and extends existing tables.

> **Known issue (fixed):** V004 uses `WHERE relationship::text = 'relative'` with a text cast because PostgreSQL cannot match against the old enum literal after `ALTER TYPE ... RENAME VALUE`. If you see an error about "invalid input value for enum persona_type: 'relative'", ensure you have the latest version of the migration file.

It creates the following new tables and alterations:

| New Tables | Purpose |
|------------|---------|
| `interaction_sessions` | Conversation session metadata (type, language, duration, transcript ref) |
| `parameter_configs` | Per-patient monitoring parameters (BP, glucose, etc.) with frequencies + thresholds |
| `topics` | Conversation topics (medications, conditions, wellness) |
| `patient_topics` | Links patients to their active topics |
| `recommendations` | Doctor/analytics parameter recommendations with accept/reject workflow |
| `conversation_prompts` | System prompts for patient_logging, caregiver_config, caregiver_onboarding |
| `vision_results` | Photo-based reading extraction results |

| Altered Tables | Changes |
|----------------|---------|
| `patients` | Added `language`, `timezone` columns |
| `reminder_configs` | Added `daily_deadline`, `frequency_days`, `timezone` columns |

---

## 7. Lambda Functions

### 7.1 Overview

Lambda functions live in `backend/lambdas/`. Each has its own `package.json` and `index.js`. Terraform packages and deploys them automatically via `archive_file` data sources in the Lambda module (`infrastructure/terraform/modules/lambda/`).

**Important:** You must run `npm install` in each Lambda directory **before** `terraform apply`, since Terraform zips the entire directory (including `node_modules/`) for deployment.

### 7.2 Install Dependencies

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

### 7.3 Lambda Environment Variables

These are set automatically by Terraform when the Lambda module deploys:

| Variable | Source | Which Lambdas |
|----------|--------|---------------|
| `DB_SECRET_NAME` | RDS module -> `db_password_secret_name` | post-confirmation, create-patient, accept-invite, invite-attendant, invite-doctor, fetch-session-config, store-interaction, construct-fhir-batch, evaluate-thresholds-batch, check-daily-deadline, check-missed-measurements, manage-recommendations, manage-parameter-configs, manage-interactions, manage-prompts |
| `COGNITO_USER_POOL_ID` | Cognito module -> extracted from ARN | post-confirmation, create-patient, accept-invite |
| `FROM_EMAIL` | Terraform variable (default: `noreply@carelog.com`) | invite-attendant, invite-doctor, process-pending-invites |
| `WEB_PORTAL_URL` | API Gateway base URL | invite-attendant, process-pending-invites |
| `APP_DOWNLOAD_URL` | Firebase App Distribution link | invite-attendant |
| `OBSERVATIONS_BUCKET` | S3 observations bucket name | patient-summary, construct-fhir-batch |
| `RAW_INTERACTIONS_BUCKET` | S3 raw interactions bucket name | store-interaction, manage-interactions |
| `S3_BUCKET_NAME` | S3 module -> `documents_bucket_name` | sync-observation, bulk-sync, presigned-url |
| `S3_KMS_KEY_ID` | S3 module -> `kms_key_arn` | sync-observation, bulk-sync, construct-fhir-batch, store-interaction |
| `SQS_ALERTS_QUEUE_URL` | SQS module -> queue URL | evaluate-thresholds-batch, check-missed-measurements |
| `EVALUATE_THRESHOLDS_FUNCTION_NAME` | Lambda name | construct-fhir-batch (async invoke) |

### 7.4 Lambda Functions Reference

#### Core Patient/Caregiver Lambdas (deployed via Terraform)

| Lambda | Route | Description |
|--------|-------|-------------|
| `create-patient` | `POST /patients` | Creates patient in RDS + Cognito. Accepts language, timezone, conditions, medications, allergies, emergency_contact. Sets `custom:linked_patient_id` on caregiver's Cognito account. |
| `patient-summary` | `GET /patients/{patientId}/summary` | Returns patient info, latest vitals from S3, interaction session metadata, unread alert count |
| `get-observations` | `GET /patients/{patientId}/observations` | Returns FHIR observations from S3 filtered by vital type and date range |
| `invite-attendant` | `POST /invites/attendant` | Creates caregiver Cognito account + RDS records, emails credentials via SES |
| `invite-doctor` | `POST /invites/doctor` | Sends doctor invite email via SES |
| `accept-invite` | `GET,POST /invites/accept` | GET serves HTML registration page; POST creates Cognito account for doctor invitees |
| `post-confirmation` | Cognito trigger | Runs after user confirms signup; creates user record in RDS, sets persona_type, adds to Cognito group (`caregivers` or `patients`) |
| `sync-observation` | `POST /observations/sync` | Stores FHIR Observation as JSON in S3 (KMS encrypted) |
| `bulk-sync` | `POST /observations/bulk-sync` | Batch stores FHIR resources in S3 |
| `presigned-url` | `POST /documents/presigned-url` | Generates S3 presigned upload/download URLs |
| `care-team` | `GET /patients/{patientId}/team` | Returns care team members (caregivers, doctors) + pending invites |
| `process-pending-invites` | EventBridge (every 2 min) | Checks pending invites for newly SES-verified emails and sends credentials emails |

#### Conversational System Lambdas (new in v3.0)

| Lambda | Route | Description |
|--------|-------|-------------|
| `fetch-session-config` | `GET /session-config/{patientId}` | Returns patient's parameter configs, topics, conversation prompts, last session info, and active recommendations. Used by Android app before starting a conversation. |
| `construct-fhir-batch` | `POST /observations/batch` | Receives batch of extracted values from a conversation session. Constructs FHIR R4 Observations (with LOINC/UCUM coding), stores in S3, and asynchronously invokes `evaluate-thresholds-batch`. |
| `store-interaction` | `POST /interactions` | Receives multipart upload (audio files + transcript JSON + photos + metadata). Stores each in S3 raw bucket at `interactions/{patientId}/{YYYY}/{MM}/{DD}/{sessionId}/`, creates `interaction_sessions` record in RDS. |
| `evaluate-thresholds-batch` | (async invoke) | Evaluates extracted values against `parameter_configs` thresholds. Creates alert records in RDS, enqueues SQS messages for `notification-sender`. Supports multi-component thresholds (e.g., systolic AND diastolic for BP). |
| `check-daily-deadline` | EventBridge (every 15 min) | Queries `parameter_configs` for deadlines. Checks today's `interaction_sessions` per patient. Sends reminder FCM via `notification-sender` for patients who haven't logged by their deadline. Timezone-aware, with duplicate prevention. |
| `check-missed-measurements` | EventBridge (every 1 hour) | Scans `parameter_configs` for overdue parameters based on `frequency_days`. Creates `missed_measurement` alerts and enqueues SQS for notification. |
| `notification-sender` | SQS consumer | Handles 3 alert types with detailed FCM payloads: `threshold_breach` (parameter name, value, threshold), `missed_measurement` (parameter, days overdue), `reminder` (deadline approaching). |

#### Doctor Portal Lambdas (new in v3.0)

| Lambda | Route | Description |
|--------|-------|-------------|
| `manage-parameter-configs` | `GET/POST/PUT/DELETE /patients/{patientId}/parameter-configs[/{id}]` | Full CRUD for patient monitoring parameters. Doctors can set thresholds (`threshold_set_by` tracks who). Soft-delete with `active=false`. |
| `manage-recommendations` | `GET/POST /patients/{patientId}/recommendations`, `PUT .../recommendations/{id}` | Doctor creates recommendations (suggested parameters/frequencies). Caregivers accept/reject. Accepting auto-creates a `parameter_config`. |
| `manage-interactions` | `GET /patients/{patientId}/interactions`, `GET .../interactions/{id}/transcript` | Paginated list of conversation sessions with metadata. Transcript retrieval fetches from S3 raw bucket. |
| `manage-prompts` | `GET /prompts`, `PUT /prompts/{promptType}` | View and update system prompts for conversation types (patient_logging, caregiver_config, caregiver_onboarding). Version bumped on each update. |

#### Notification & Alert Lambdas (new in v3.0, deployed via Terraform)

| Lambda | Route / Trigger | Description |
|--------|----------------|-------------|
| `notification-sender` | SQS consumer (alerts queue) | Sends FCM push notifications for threshold breaches, missed measurements, and reminders |
| `alert-crud` | `GET/POST /patients/{patientId}/alerts` | CRUD for patient alerts (threshold breach, missed measurement) |
| `threshold-crud` | `GET/POST/PUT/DELETE /patients/{patientId}/thresholds` | CRUD for vital thresholds |
| `device-token` | `POST/DELETE /device-tokens` | Register/unregister FCM device tokens |
| `reminder-crud` | `GET/POST/PUT/DELETE /patients/{patientId}/reminders` | CRUD for measurement reminders |
| `remove-team-member` | `DELETE /patients/{patientId}/team/{memberId}` | Removes team member, disables Cognito account |

#### Scaffolded (code exists but not yet wired in Terraform)

`account-deletion`, `audit-log`, `care-plan`, `consent`, `create-document-reference`, `data-export`, `delete-patient`, `doctor-documents`, `doctor-patients`, `observation-annotation`

### 7.5 EventBridge Schedules

The following EventBridge rules are managed by Terraform (module `infrastructure/terraform/modules/eventbridge/`):

| Rule | Schedule | Lambda | Description |
|------|----------|--------|-------------|
| `carelog-check-daily-deadline-{env}` | Every 15 minutes | `check-daily-deadline` | Checks for patients whose daily measurement deadline has passed |
| `carelog-check-missed-measurements-{env}` | Every 1 hour | `check-missed-measurements` | Scans for overdue measurements based on configured frequencies |
| `carelog-dev-process-pending-invites` | Every 2 minutes | `process-pending-invites` | Polls pending invite records; sends credentials when SES-verified |

> **Note:** The `process-pending-invites` schedule may need to be created manually if not yet in Terraform. See the command in section 7.6.

### 7.6 Manual EventBridge Rule (if needed)

If `process-pending-invites` is not managed by Terraform:

```bash
REGION="ap-south-1"
LAMBDA_ARN=$(aws lambda get-function --function-name carelog-dev-process-pending-invites \
    --region $REGION --query 'Configuration.FunctionArn' --output text)

aws events put-rule --name carelog-dev-process-pending-invites \
    --schedule-expression "rate(2 minutes)" --state ENABLED --region $REGION

aws events put-targets --rule carelog-dev-process-pending-invites \
    --targets "Id=1,Arn=$LAMBDA_ARN" --region $REGION

aws lambda add-permission --function-name carelog-dev-process-pending-invites \
    --statement-id eventbridge-invoke --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn $(aws events describe-rule --name carelog-dev-process-pending-invites \
        --region $REGION --query 'Arn' --output text) \
    --region $REGION
```

### 7.7 API Routes Summary

| Method | Path | Lambda | Auth Groups |
|--------|------|--------|-------------|
| POST | `/patients` | create-patient | caregivers |
| GET | `/patients/{patientId}/summary` | patient-summary | patients, caregivers, doctors |
| GET | `/patients/{patientId}/observations` | get-observations | patients, caregivers, doctors |
| POST | `/invites/attendant` | invite-attendant | caregivers |
| POST | `/invites/doctor` | invite-doctor | caregivers |
| GET,POST | `/invites/accept` | accept-invite | (no auth) |
| POST | `/observations/sync` | sync-observation | patients, caregivers |
| POST | `/observations/bulk-sync` | bulk-sync | patients, caregivers |
| POST | `/documents/presigned-url` | presigned-url | any authenticated |
| GET | `/patients/{patientId}/team` | care-team | caregivers, doctors |
| GET | `/session-config/{patientId}` | fetch-session-config | patients, caregivers |
| POST | `/interactions` | store-interaction | patients, caregivers |
| POST | `/observations/batch` | construct-fhir-batch | patients, caregivers |
| GET | `/patients/{patientId}/recommendations` | manage-recommendations | caregivers, doctors |
| POST | `/patients/{patientId}/recommendations` | manage-recommendations | doctors |
| PUT | `/patients/{patientId}/recommendations/{id}` | manage-recommendations | caregivers |
| GET | `/patients/{patientId}/parameter-configs` | manage-parameter-configs | caregivers, doctors |
| POST | `/patients/{patientId}/parameter-configs` | manage-parameter-configs | caregivers, doctors |
| PUT | `/patients/{patientId}/parameter-configs/{id}` | manage-parameter-configs | caregivers, doctors |
| DELETE | `/patients/{patientId}/parameter-configs/{id}` | manage-parameter-configs | caregivers, doctors |
| GET | `/patients/{patientId}/interactions` | manage-interactions | caregivers, doctors |
| GET | `/patients/{patientId}/interactions/{id}/transcript` | manage-interactions | caregivers, doctors |
| GET | `/prompts` | manage-prompts | any authenticated |
| PUT | `/prompts/{promptType}` | manage-prompts | doctors |
| GET | `/patients/{patientId}/alerts` | alert-crud | caregivers, doctors |
| POST | `/patients/{patientId}/alerts/{id}/read` | alert-crud | caregivers |
| GET,POST | `/patients/{patientId}/thresholds` | threshold-crud | caregivers, doctors |
| PUT,DELETE | `/patients/{patientId}/thresholds/{id}` | threshold-crud | caregivers, doctors |
| POST,DELETE | `/device-tokens` | device-token | any authenticated |
| GET,POST | `/patients/{patientId}/reminders` | reminder-crud | caregivers |
| PUT,DELETE | `/patients/{patientId}/reminders/{id}` | reminder-crud | caregivers |
| DELETE | `/patients/{patientId}/team/{memberId}` | remove-team-member | caregivers |
| PUT | `/patients/{patientId}/language` | (handler) | caregivers |
| POST | `/patients/{patientId}/topics/{topicId}` | (handler) | caregivers |

### 7.8 Persona Flow

1. Only **caregivers** can self-register via the app
2. Caregivers create a patient -> `create-patient` (accepts language, timezone, conditions, medications, allergies, emergency_contact; creates caregiver's RDS user record if missing; sets `custom:linked_patient_id` on their Cognito account)
3. Caregivers can onboard patients via a **conversational flow** in the Android app, which extracts profile information from natural language
4. Caregivers configure monitoring protocols (parameters, frequencies, thresholds) via conversation or manually
5. Caregivers invite other caregivers -> `invite-attendant` creates the caregiver's Cognito account + RDS records, emails credentials
6. Caregivers invite doctors -> `invite-doctor` sends invite email; doctors accept via `accept-invite` HTML registration page
7. **Patient conversation flow**: Patient speaks in preferred language -> STT (Mac Mini) -> LLM extracts values -> Patient confirms -> FHIR batch constructed (Lambda) -> Thresholds evaluated -> Alerts sent to caregivers
8. **Doctors** manage patient parameters, thresholds, and recommendations via the web portal

---

## 8. Web Portal Deployment

### 8.1 Development

```bash
cd web-portal
npm install
npm run dev    # Starts Vite dev server at http://localhost:5173
```

### 8.2 Production Build

```bash
cd web-portal
npm run build    # Type-check (tsc) + Vite production build -> dist/
```

### 8.3 Deploy to S3 + CloudFront

```bash
# Build
cd web-portal && npm install && npm run build

# Deploy to S3
aws s3 sync dist/ s3://carelog-dev-web-portal/ --delete --region ap-south-1

# Invalidate CloudFront cache (if configured)
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

### 8.4 New Features in v3.0

The web portal (doctor-facing) has 3 new tabs in the Patient View:

| Tab | Component | Purpose |
|-----|-----------|---------|
| **Protocol** | `ProtocolTab.tsx` | View/add/edit/remove patient monitoring parameters (BP, glucose, etc.) with frequencies, thresholds, and deadlines |
| **Recommendations** | `RecommendationsTab.tsx` | Create parameter recommendations for caregivers; view accept/reject status; filter by status |
| **Interactions** | `InteractionsTab.tsx` | View conversation session history; click to view full transcripts in chat-bubble format |

### 8.5 Tests

```bash
cd web-portal
npm run test           # Vitest
npm run test:coverage  # Vitest with coverage
npm run lint           # ESLint
```

---

## 9. Configure Amplify (Mobile Apps)

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

## 10. Android Development

### 10.1 Setup

1. Open `matika/android` in Android Studio
2. Wait for Gradle sync
3. Copy `google-services.json` to `android/app/`

### 10.2 New in v3.0

The Android app includes the following new modules:

| Package | Purpose |
|---------|---------|
| `discovery/` | Mac Mini mDNS discovery (`_carelog._tcp`) + health check polling (10s interval) |
| `conversation/` | Full voice conversation flow: audio capture, STT/LLM/TTS pipeline, session management, value extraction + confirmation |
| `conversation/audio/` | Audio pipeline: PCM 16kHz capture, VAD silence detection, batch + streaming modes |
| `conversation/photo/` | Camera capture for device photo readings (BP monitors, glucometers) |
| `conversation/instrumentation/` | Pipeline latency tracking (t0-t7 timestamps, P50/P95/P99 stats) |
| `onboarding/` | Caregiver onboarding flow: patient setup, protocol config, credential invites |
| `dashboard/` | Patient home screen (last session, model status) + caregiver dashboard (alerts, urgency) |
| `core/di/NetworkModule.kt` | Dual Retrofit instances: `@CloudApi` (AWS HTTPS) + `@MacMiniApi` (LAN HTTP) with cert pinning |
| `core/config/AppSettings.kt` | DataStore settings: audio mode, Mac Mini URL, language preference |

### 10.3 Network Configuration

The app uses **dual networking**:
- **LAN (HTTP)**: Direct connection to Mac Mini for STT, LLM, TTS, Vision inference (low latency)
- **Cloud (HTTPS)**: AWS API Gateway for authentication, data persistence, configuration

The Mac Mini URL is discovered automatically via mDNS. Manual override is available in Settings.

**Important:** `network_security_config.xml` allows cleartext HTTP to the local network (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`) for Mac Mini communication. This is by design.

### 10.4 Create Emulator

In Android Studio: **Tools -> Device Manager -> Create Device -> Pixel 6 -> API 34**

> **Emulator DNS fix:** The emulator may not resolve AWS API Gateway hostnames. Add DNS config to the AVD:
> ```bash
> echo "hw.dns.1 = 8.8.8.8" >> ~/.android/avd/YOUR_AVD.avd/config.ini
> echo "hw.dns.2 = 8.8.4.4" >> ~/.android/avd/YOUR_AVD.avd/config.ini
> ```
> Or launch with: `emulator -avd YOUR_AVD -dns-server 8.8.8.8`

### 10.5 Run

```bash
cd android

# Emulator
emulator -list-avds
emulator -avd Pixel_6_API_34 -dns-server 8.8.8.8 &

# Build + install
./gradlew installDebug

# Or launch directly
adb shell am start -n com.carelog/.ui.MainActivity
```

### 10.6 Build APKs

```bash
./gradlew assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease   # -> app/build/outputs/apk/release/app-release.apk
```

Release builds require a keystore in `local.properties`:

```properties
RELEASE_STORE_FILE=../carelog-release.keystore
RELEASE_STORE_PASSWORD=your_keystore_password
RELEASE_KEY_ALIAS=carelog
RELEASE_KEY_PASSWORD=your_key_password
```

Generate one with: `keytool -genkey -v -keystore carelog-release.keystore -alias carelog -keyalg RSA -keysize 2048 -validity 10000`

### 10.7 Tests

```bash
./gradlew test                    # Unit tests
./gradlew connectedAndroidTest    # Instrumentation tests (requires emulator)
```

---

## 11. iOS Development

### 11.1 Setup

```bash
cd ios/CareLog
open CareLog.xcodeproj    # or CareLog.xcworkspace if using CocoaPods
```

Copy `GoogleService-Info.plist` to `ios/CareLog/CareLog/` and add it to the Xcode project.

Configure signing: **Project -> CareLog target -> Signing & Capabilities -> select your Team**.

### 11.2 Run in Simulator

```bash
xcrun simctl boot "iPhone 15 Pro"

xcodebuild -scheme CareLog \
    -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build

xcrun simctl install booted build/Debug-iphonesimulator/CareLog.app
xcrun simctl launch booted com.carelog.CareLog
```

Or use Xcode: select simulator from dropdown, press `Cmd + R`.

### 11.3 Tests

```bash
xcodebuild test -scheme CareLog \
    -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
```

---

## 12. Firebase App Distribution

### 12.1 Prerequisites

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

### 12.2 Firebase Authentication

```bash
# Login to Firebase (opens browser)
firebase login

# Generate a CI token for automated distribution (opens browser)
firebase login:ci
# Save the printed token — you'll use it as FIREBASE_TOKEN
```

**Firebase project:** `carelog-7de0c`
**Android App ID:** `1:191872106923:android:63245761468592e0d612ee`

> **Important:** The Fastlane `distribute_debug` lane requires two environment variables:
> - `FIREBASE_ANDROID_APP_ID` — the Android App ID above (the Fastfile defaults to a placeholder if unset)
> - `FIREBASE_TOKEN` — the CI token from `firebase login:ci`
>
> Without both, uploads will fail with "does not have the required permissions".

### 12.3 Install Fastlane Dependencies

```bash
cd android
bundle install    # Installs fastlane + firebase_app_distribution plugin from Gemfile
```

The `Gemfile` and `fastlane/` directory are already configured in the repo.

### 12.4 Android Distribution (Fastlane)

Three distribution lanes are available:

| Lane | Build Type | Tester Groups | Command |
|------|-----------|---------------|---------|
| `distribute_debug` | Debug APK | `internal-testers` | `bundle exec fastlane distribute_debug` |
| `distribute` | Release APK | `internal-testers`, `qa-team` | `bundle exec fastlane distribute` |
| `beta` | Release APK | `beta-testers` | `bundle exec fastlane beta` |

**Distribute a debug build to internal testers:**

```bash
cd android
export FIREBASE_ANDROID_APP_ID="1:191872106923:android:63245761468592e0d612ee"
export FIREBASE_TOKEN="<your-firebase-ci-token>"
bundle exec fastlane distribute_debug
```

**Custom release notes:**

```bash
bundle exec fastlane distribute_debug release_notes:"Add conversational health logging flow"
```

### 12.5 Creating Tester Groups

Before distributing, create the tester groups in Firebase:

```bash
firebase appdistribution:group:create internal-testers "Internal Testers" --project carelog-7de0c
firebase appdistribution:group:create qa-team "QA Team" --project carelog-7de0c
firebase appdistribution:group:create beta-testers "Beta Testers" --project carelog-7de0c
```

### 12.6 Managing Testers

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

### 12.7 iOS Distribution

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

### 12.8 GitHub Actions (Automated)

The CI workflow (`.github/workflows/android-ci.yml`) automatically distributes to `internal-testers` on pushes to `develop`:

```bash
# Merge to develop to trigger automatic distribution
git checkout develop
git merge main
git push origin develop
```

**Required GitHub Secrets** (configure in repo Settings -> Secrets):

| Secret | Value |
|--------|-------|
| `FIREBASE_APP_ID` | `1:191872106923:android:63245761468592e0d612ee` |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON content |
| `AWS_ACCESS_KEY_ID` | AWS credentials for Lambda/Terraform deployments |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for Lambda/Terraform deployments |

### 12.9 Troubleshooting Firebase Distribution

| Error | Cause | Fix |
|-------|-------|-----|
| `Unable to locate a Java Runtime` | JAVA_HOME not set | `export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home` |
| `SDK location not found` | Missing local.properties | Create `android/local.properties` with `sdk.dir=<path-to-sdk>` |
| `Keystore file not found for signing config 'externalOverride'` | Fastlane injects empty signing env vars | Use `distribute_debug` lane (no signing needed) or set `KEYSTORE_*` env vars |
| `Invalid request` during distribution | Tester group doesn't exist | Create group first: `firebase appdistribution:group:create <name> "<display>" --project carelog-7de0c` |
| `Could not locate Gemfile` | Wrong directory | Run from `android/` directory, not project root |

---

## 13. Test Automation

### 13.1 Overview

The `test-automation/` directory contains E2E tests, integration tests, multilingual validation, performance benchmarks, and compliance verification scripts.

```bash
cd test-automation
npm install
```

### 13.2 E2E Test Scenarios

| # | Scenario | What it tests |
|---|----------|---------------|
| E2E-1 | Full patient logging session | Caregiver configures BP + glucose -> Patient conversation -> Confirms -> FHIR stored |
| E2E-2 | Photo-based device reading | Camera capture -> Vision extraction -> FHIR stored |
| E2E-3 | Threshold breach alert | Patient logs high BP -> Caregiver notified within 60s |
| E2E-4 | Missed measurement alert | No logging for N days -> Caregiver notified |
| E2E-5 | Caregiver onboarding | Register -> Onboard patient -> Configure protocol -> Send invite |
| E2E-6 | Pause timeout | Patient pauses -> 5-min timeout -> Session auto-ends |
| E2E-7 | Doctor protocol update | Doctor adds threshold via portal -> Next session uses it |
| E2E-8 | STT failure fallback | Speech garbage -> Text input fallback |
| E2E-9 | Emergency detection | "Chest pain" in Hindi -> Emergency advice -> Caregiver alerted |
| E2E-10 | Mac Mini offline | Power off -> Health check fails -> Conversation button disabled |

```bash
# Run all E2E tests
npx vitest run e2e/

# Run a specific scenario
npx vitest run e2e/scenarios/e2e-03-threshold-breach-alert.test.ts
```

### 13.3 Integration Tests

```bash
npx vitest run integration/
```

Tests cover: conversation-FHIR pipeline, threshold evaluation, session config fetch, interaction storage, reminder pipeline, missed measurement detection, doctor protocol updates.

### 13.4 Multilingual Validation

```bash
npx vitest run multilingual/
```

Tests STT accuracy, LLM extraction, and TTS quality across English, Hindi, and Bengali including code-mixed speech.

### 13.5 Performance Benchmarks

```bash
# Run latency benchmarks (100 turns, 3 languages)
npx ts-node performance/latency-benchmark.ts

# Generate P50/P95/P99 report
npx ts-node performance/latency-report.ts
```

Target: P95 total pipeline latency < 2000ms.

### 13.6 Compliance Verification

```bash
cd test-automation

# Run all compliance checks
npx ts-node compliance/data-localisation-verify.ts    # All data in ap-south-1
npx ts-node compliance/phi-log-scan.ts                # No PHI in logs
npx ts-node compliance/mac-mini-cleanup-verify.ts     # No persistent patient data
npx ts-node compliance/encryption-verify.ts           # S3 SSE-KMS, RDS encryption, TLS
npx ts-node compliance/access-control-verify.ts       # Cognito groups, API auth
npx ts-node compliance/audit-logging-verify.ts        # CloudTrail multi-region, Object Lock
npx ts-node compliance/data-retention-verify.ts       # S3 lifecycle, CloudWatch retention
npx ts-node compliance/cert-pinning-verify.ts         # TLS version, cipher suites
npx ts-node compliance/mac-mini-security-verify.ts    # LAN-only, firewall, FileVault
npx ts-node compliance/cognito-security-verify.ts     # MFA, token expiry, password policy

# Or run the full pilot readiness check (runs all of the above)
npx ts-node pilot/pilot-readiness-check.ts
```

---

## 14. CI/CD Pipelines

### 14.1 GitHub Actions Workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Run Tests | `.github/workflows/run-tests.yml` | Push/PR | Lint, type-check, unit tests, build checks for all components |
| Deploy Lambdas | `.github/workflows/deploy-lambdas.yml` | Manual | Package and deploy Lambda functions to selected environment |
| Run Migrations | `.github/workflows/run-migrations.yml` | Manual | Run Flyway migrations via SSM port-forward |

### 14.2 Running Locally

```bash
# Lint + type-check web portal
cd web-portal && npm run lint && npx tsc --noEmit

# Run Mac Mini service tests
cd mac-mini && python -m pytest tests/ -v

# Run Lambda unit tests
cd backend/lambdas/construct-fhir-batch && npm test
cd backend/lambdas/fetch-session-config && npm test
# ... (each Lambda has its own test suite)

# Run test automation suite
cd test-automation && npx vitest run
```

---

## 15. Monitoring & Alerting

### 15.1 CloudWatch Alarms

Terraform deploys the following alarms (module `infrastructure/terraform/modules/monitoring/`):

| Alarm | Condition | Action |
|-------|-----------|--------|
| Lambda error rate | > 5% over 5 min | SNS -> operator email |
| Lambda duration (construct-fhir-batch) | P95 > 5s | SNS -> operator email |
| API Gateway 5xx rate | > 1% over 5 min | SNS -> operator email |
| SQS dead letter queue depth | > 0 | SNS -> operator email |
| RDS CPU utilization | > 80% for 10 min | SNS -> operator email |
| RDS free storage | < 5 GB | SNS -> operator email |

### 15.2 CloudWatch Dashboard

A dashboard named `carelog-{env}-dashboard` is created with panels for Lambda invocations, errors, duration, API Gateway requests, RDS metrics, and SQS queue depth.

### 15.3 Mac Mini Monitoring

On the Mac Mini, cron jobs log health data:

```bash
# View recent health logs
tail -50 /opt/carelog/logs/health-cron.log

# View service logs
tail -f /opt/carelog/logs/stt.log
tail -f /opt/carelog/logs/llm.log
```

### 15.4 Lambda Logs

```bash
# Follow logs in real time
aws logs tail /aws/lambda/carelog-dev-FUNCTION-NAME --follow --region ap-south-1

# View last 5 minutes
aws logs tail /aws/lambda/carelog-dev-FUNCTION-NAME --since 5m --region ap-south-1
```

Deployed function names (28 total): `post-confirmation`, `create-patient`, `patient-summary`, `accept-invite`, `invite-attendant`, `invite-doctor`, `process-pending-invites`, `sync-observation`, `bulk-sync`, `presigned-url`, `care-team`, `fetch-session-config`, `construct-fhir-batch`, `store-interaction`, `evaluate-thresholds-batch`, `check-daily-deadline`, `check-missed-measurements`, `notification-sender`, `manage-recommendations`, `manage-parameter-configs`, `manage-interactions`, `manage-prompts`, `alert-crud`, `threshold-crud`, `device-token`, `reminder-crud`, `remove-team-member`, `get-observations`.

---

## 16. Troubleshooting

### Verifying Observation Sync (Android)

After building and deploying the app, verify that FHIR observations sync correctly from the device to S3:

1. **Build and install:**
   ```bash
   cd android && ./gradlew clean installDebug
   ```

2. **Log a reading** via the conversational flow (or manually via the app).

3. **Force restart the app** to trigger sync:
   ```bash
   adb shell am force-stop com.carelog
   adb shell monkey -p com.carelog -c android.intent.category.LAUNCHER 1
   ```

4. **Watch sync logs:**
   ```bash
   adb logcat -s "FhirSyncWorker" "HealthLakeFhirClient" "ConversationRepository" | grep -i "sync\|error\|observation\|fhir"
   ```

5. **Verify observations in S3:**
   ```bash
   aws s3 ls s3://<YOUR_BUCKET>/observations/ --recursive --region ap-south-1
   ```

6. **Verify raw interactions in S3:**
   ```bash
   aws s3 ls s3://<RAW_BUCKET>/interactions/ --recursive --region ap-south-1
   ```

### Mac Mini Not Discovered

If the Android app doesn't find the Mac Mini:

1. **Verify mDNS is registered:**
   ```bash
   # On the Mac Mini
   dns-sd -B _carelog._tcp
   ```

2. **Verify services are running:**
   ```bash
   curl http://<mac-mini-ip>:8000/health
   ```

3. **Check they're on the same network** — Mac Mini and Android device must be on the same WiFi/LAN subnet.

4. **Check firewall** — ensure ports 8000-8004 are allowed:
   ```bash
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --listapps
   ```

### Conversation Flow Issues

| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| "Conversation button disabled" | Mac Mini health check failing | Check Mac Mini services (`curl localhost:8000/health`) |
| STT returns garbage | Audio format mismatch | Verify PCM 16kHz mono format in audio capture settings |
| LLM doesn't extract values | Session config missing | Check `fetch-session-config` Lambda logs; verify `parameter_configs` exist for patient |
| TTS silent | Language mismatch | Verify TTS model exists for patient's language (piper-en/hi/bn.onnx) |
| Values not saved | FHIR batch Lambda error | Check `construct-fhir-batch` Lambda logs |
| Alerts not sent | Threshold eval / SQS issue | Check `evaluate-thresholds-batch` logs, SQS DLQ depth |

### API returns 403 "Access denied" for valid users

The Lambda `checkAccess()` functions use `WHERE p.id = $1::uuid` to verify patient access. If you see 403s:

1. **Check that `custom:linked_patient_id`** in Cognito contains the patient's **UUID** (from `patients.id`), not the string patient ID (from `patients.patient_id`).
2. **Check `persona_links`** — the user must have an active link to the patient with `is_active = true`.
3. **Check Lambda logs** for the exact query failure:
   ```bash
   aws logs tail /aws/lambda/carelog-dev-patient-summary --since 5m --region ap-south-1
   ```

### Bastion SG rule missing after `terraform apply`

If `terraform apply` replaces the bastion instance, the RDS security group rule allowing bastion access may be lost (state drift). Re-apply it:

```bash
cd infrastructure/terraform/environments/dev
terraform apply -target="module.carelog.module.bastion[0].aws_security_group_rule.bastion_to_rds" -auto-approve
```

Or manually:
```bash
BASTION_ID=$(terraform output -raw bastion_instance_id)
BASTION_SG=$(aws ec2 describe-instances --instance-ids $BASTION_ID \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text --region ap-south-1)
RDS_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=*carelog*rds*" \
  --query 'SecurityGroups[0].GroupId' --output text --region ap-south-1)
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG --protocol tcp --port 5432 \
  --source-group $BASTION_SG --region ap-south-1
```

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
# Then in Xcode: File -> Packages -> Reset Package Caches
```

### Backend

```bash
# Terraform state lock
terraform force-unlock LOCK_ID

# Manual Lambda code update
aws lambda update-function-code --function-name carelog-dev-FUNCTION-NAME --zip-file fileb://function.zip --region ap-south-1
```

---

## Quick Reference

| Task | Command |
|------|---------|
| **Provision Mac Mini** | `cd mac-mini/deploy && sudo ./provision.sh` |
| **Check Mac Mini health** | `curl http://<mac-mini-ip>:8000/health` |
| **Update model** | `cd mac-mini/deploy && sudo ./update-model.sh <service> <url>` |
| **Deploy infrastructure** | `cd infrastructure/terraform/environments/dev && terraform apply` |
| **Port-forward to RDS** | `aws ssm start-session --target BASTION_ID ...` (see section 6.2) |
| **Run DB migrations** | `cd backend/database && flyway migrate` |
| **Install Lambda deps** | `cd backend/lambdas/FUNCTION && npm install` |
| **Web portal dev server** | `cd web-portal && npm run dev` |
| **Web portal build** | `cd web-portal && npm run build` |
| **Android debug build** | `cd android && ./gradlew assembleDebug` |
| **Android tests** | `cd android && ./gradlew test` |
| **iOS build** | `cd ios/CareLog && xcodebuild -scheme CareLog -destination '...' build` |
| **iOS tests** | `cd ios/CareLog && xcodebuild test -scheme CareLog -destination '...'` |
| **Distribute Android** | `cd android && bundle exec fastlane distribute_debug` |
| **Distribute iOS** | `cd ios/CareLog && bundle exec fastlane distribute` |
| **Run E2E tests** | `cd test-automation && npx vitest run e2e/` |
| **Run compliance checks** | `cd test-automation && npx ts-node pilot/pilot-readiness-check.ts` |
| **Run latency benchmarks** | `cd test-automation && npx ts-node performance/latency-benchmark.ts` |
| **Mac Mini service tests** | `cd mac-mini && python -m pytest tests/ -v` |
| **View Lambda logs** | `aws logs tail /aws/lambda/carelog-dev-FUNCTION --follow` |
| **Pilot Mac Mini setup** | `cd mac-mini/deploy && sudo ./pilot-setup.sh --hostname NAME` |

---

## FAQ

### How do I reset the database and remove all users?

**1. Delete all Cognito users:**

```bash
REGION="ap-south-1"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region $REGION \
    --query 'UserPools[?Name==`carelog-dev-users`].Id' --output text)

# List all users first
aws cognito-idp list-users --user-pool-id $POOL_ID --region $REGION \
    --query 'Users[].{Username:Username,Status:UserStatus}' --output table

# Delete all users
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

**2. Delete a single user:**

```bash
REGION="ap-south-1"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region $REGION \
    --query 'UserPools[?Name==`carelog-dev-users`].Id' --output text)

aws cognito-idp admin-delete-user \
    --user-pool-id $POOL_ID \
    --username "USERNAME_OR_SUB_UUID" \
    --region $REGION
```

**3. Reset the database** (requires SSM port-forward running in another terminal):

```bash
cd backend/database
echo 'flyway.cleanDisabled=false' >> flyway.conf
flyway clean    # drops all objects
flyway migrate  # recreates schema from scratch (V001-V004)
```

> **Warning:** `flyway clean` drops everything — only use in dev.

### How do I create pre-confirmed test accounts?

Useful for testing without email verification:

```bash
REGION="ap-south-1"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region $REGION \
    --query 'UserPools[?Name==`carelog-dev-users`].Id' --output text)
CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id $POOL_ID \
    --region $REGION --query 'UserPoolClients[?ClientName==`carelog-mobile-client`].ClientId' --output text)
PASSWORD="Carelog2026@x"

# Create and confirm a user in one go
EMAIL="testuser@example.com"
NAME="Test User"
PERSONA="caregiver"  # or: patient, doctor

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

> **Note:** Valid persona types are `caregiver`, `patient`, `doctor`. The old `relative` and `attendant` types are no longer used.

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

### How do I get the database password?

```bash
aws secretsmanager get-secret-value --secret-id carelog-dev-db-password --region ap-south-1 \
    --query 'SecretString' --output text | \
    python3 -c "import sys,json; print(json.loads(sys.stdin.read())['password'])"
```

### Not receiving Cognito verification emails?

1. Check spam/junk folder
2. If using Cognito default email: daily limit is 50 — switch to SES (see section 1.4)
3. If using SES in sandbox mode: recipient email must be verified too (`aws ses verify-email-identity`)
4. Resend code: `aws cognito-idp resend-confirmation-code --client-id CLIENT_ID --username USERNAME --region ap-south-1`
5. Skip email and confirm manually: see "How do I manually confirm a user" above

### "Could not find the required online resource" when signing in?

The app has a stale Cognito Pool ID from a previous deployment. After `terraform destroy` + `terraform apply`, the pool ID changes. Re-run the Amplify config update (section 9):

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

### How do I test the conversation flow end-to-end?

1. **Ensure Mac Mini is running** and all 5 services are healthy (`curl http://<mac-mini-ip>:8000/health`)
2. **Ensure backend is deployed** with V004 migration applied
3. **Create a test caregiver account** (see "How do I create pre-confirmed test accounts")
4. **Create a patient** via the app's caregiver flow (or via API)
5. **Configure parameters** for the patient (at minimum, one parameter like blood_pressure)
6. **Log in as the patient** on the Android app
7. **Start a conversation** — the app should discover the Mac Mini, fetch session config, and present the conversation UI
8. **Speak a vital reading** (e.g., "my blood pressure is 130 over 85") — the system should extract, confirm, and store it
9. **Verify**: Check S3 for FHIR observations, check `interaction_sessions` in RDS, check Lambda logs

### How do I set up a pilot Mac Mini for a household?

```bash
cd mac-mini/deploy

# 1. Run pilot setup (includes full provisioning + household config)
sudo ./pilot-setup.sh --hostname "household-kumar" --wifi-ssid "KumarHome" --wifi-pass "password"

# 2. Run smoke test to verify everything works
./pilot-smoke-test.sh

# 3. Verify from the Android app on the same network
#    The app should auto-discover the Mac Mini via mDNS
```

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-25 | Added model download script (`mac-mini/scripts/download-models.sh`) with Hugging Face URLs |
| 2026-04-25 | Updated Cognito groups: 5 groups (patients, attendants, relatives, caregivers, doctors) |
| 2026-04-25 | Added 6 Lambdas to Terraform: notification-sender, alert-crud, threshold-crud, device-token, reminder-crud, remove-team-member (28 total) |
| 2026-04-25 | Fixed V004 migration `::text` cast for enum rename compatibility |
| 2026-04-25 | Fixed Lambda `checkAccess` queries: `p.patient_id` (string) -> `p.id` (UUID) in 7 Lambdas |
| 2026-04-25 | Added emulator DNS fix documentation |
| 2026-04-25 | Added bastion SG troubleshooting for post-`terraform apply` drift |
| 2026-04-25 | Added API 403 troubleshooting section |

---

*CareLog Setup and Deployment Guide v3.0 — April 2026*
