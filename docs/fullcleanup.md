# CareLog — Full Cleanup Guide (Start from Scratch)

**Purpose:** Tear down all CareLog infrastructure, local services, and build artifacts so you can redeploy from a clean state.

**Order matters:** Follow the steps in sequence to avoid dependency conflicts.

---

## Step 1: Kill Local Services

```bash
# Stop Mac Mini AI services
pkill -f uvicorn 2>/dev/null

# Stop any running emulator
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
$ANDROID_HOME/platform-tools/adb emu kill 2>/dev/null

# Kill any SSM sessions
pkill -f "aws ssm start-session" 2>/dev/null
```

---

## Step 2: Destroy Terraform Infrastructure

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform destroy
```

This removes: VPC, Cognito, API Gateway, all 28 Lambdas, RDS, S3 buckets, SQS queues, SNS topics, bastion, EventBridge rules, CloudWatch alarms/dashboard. RDS deletion takes 5-15 minutes.

---

## Step 3: Clean Up Resources That Survive `terraform destroy`

```bash
REGION="ap-south-1"

# Force-delete Secrets Manager (otherwise waits 7-30 days)
aws secretsmanager delete-secret --secret-id carelog-dev-db-password \
    --force-delete-without-recovery --region $REGION 2>/dev/null

# Delete leftover CloudWatch log groups
for prefix in /aws/vpc/carelog-dev /aws/apigateway/carelog-dev /aws/lambda/carelog-dev; do
    for lg in $(aws logs describe-log-groups --log-group-name-prefix "$prefix" \
        --query 'logGroups[].logGroupName' --output text --region $REGION 2>/dev/null); do
        echo "Deleting $lg"
        aws logs delete-log-group --log-group-name "$lg" --region $REGION
    done
done
```

---

## Step 4: Clean Up Cognito

```bash
REGION="ap-south-1"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 20 --region $REGION \
    --query 'UserPools[?contains(Name, `carelog`)].Id' --output text)

if [ -n "$POOL_ID" ]; then
    echo "Found pool: $POOL_ID"

    # Delete all users
    aws cognito-idp list-users --user-pool-id $POOL_ID --region $REGION \
        --query 'Users[].Username' --output json | \
        python3 -c "
import json, sys, subprocess
users = json.load(sys.stdin)
print(f'Deleting {len(users)} users...')
for u in users:
    subprocess.run(['aws', 'cognito-idp', 'admin-delete-user',
        '--user-pool-id', '$POOL_ID', '--username', u, '--region', '$REGION'],
        capture_output=True)
print('Done.')
"

    # Delete domain
    DOMAIN=$(aws cognito-idp describe-user-pool --user-pool-id $POOL_ID \
        --region $REGION --query 'UserPool.Domain' --output text 2>/dev/null)
    [ -n "$DOMAIN" ] && [ "$DOMAIN" != "None" ] && \
        aws cognito-idp delete-user-pool-domain --user-pool-id $POOL_ID --domain "$DOMAIN" --region $REGION

    # Delete pool
    aws cognito-idp delete-user-pool --user-pool-id $POOL_ID --region $REGION 2>/dev/null
fi
```

---

## Step 5: Clean Up IAM Roles

```bash
for role in $(aws iam list-roles --query 'Roles[?contains(RoleName, `carelog`)].RoleName' --output text); do
    echo "Cleaning: $role"
    for policy in $(aws iam list-attached-role-policies --role-name $role --query 'AttachedPolicies[].PolicyArn' --output text); do
        aws iam detach-role-policy --role-name $role --policy-arn $policy
    done
    for policy in $(aws iam list-role-policies --role-name $role --query 'PolicyNames[]' --output text); do
        aws iam delete-role-policy --role-name $role --policy-name $policy
    done
    for profile in $(aws iam list-instance-profiles-for-role --role-name $role --query 'InstanceProfiles[].InstanceProfileName' --output text); do
        aws iam remove-role-from-instance-profile --instance-profile-name $profile --role-name $role
        aws iam delete-instance-profile --instance-profile-name $profile
    done
    aws iam delete-role --role-name $role
done
```

---

## Step 6: Clean Up S3 (if buckets survived)

```bash
for bucket in $(aws s3 ls | grep carelog | awk '{print $3}'); do
    echo "Emptying and deleting: $bucket"
    aws s3 rb "s3://$bucket" --force --region ap-south-1
done
```

---

## Step 7: Reset Local Terraform State

```bash
cd infrastructure/terraform/environments/dev
rm -rf .terraform terraform.tfstate terraform.tfstate.backup tfplan .terraform.lock.hcl
```

---

## Step 8: Clean Up Local Mac Mini Provisioning

```bash
# Remove model directory and all service data
sudo rm -rf /opt/carelog

# Remove launchd plists
sudo rm -f /Library/LaunchDaemons/com.carelog.*.plist

# Remove cron jobs
crontab -l 2>/dev/null | grep -v carelog | crontab -
```

---

## Step 9: Clean Android Build Artifacts

```bash
cd android
./gradlew clean
rm -rf app/build .gradle
```

---

## Step 10: Clean Web Portal Build

```bash
cd web-portal
rm -rf dist node_modules
```

---

## Step 11: Clean Backend Lambda node_modules

```bash
cd backend/lambdas
for dir in */; do
    rm -rf "$dir/node_modules" "$dir/package-lock.json"
done
```

---

## Step 12: Clean Flyway Config (contains password)

```bash
rm -f backend/database/flyway.conf
```

---

## Step 13: Verify Clean State

```bash
REGION="ap-south-1"

echo "=== Cognito ==="
aws cognito-idp list-user-pools --max-results 20 --region $REGION \
    --query 'UserPools[?contains(Name, `carelog`)].{Name:Name,Id:Id}' --output table

echo "=== Lambdas ==="
aws lambda list-functions --region $REGION \
    --query 'Functions[?starts_with(FunctionName, `carelog`)].FunctionName' --output text

echo "=== S3 ==="
aws s3 ls | grep carelog

echo "=== IAM ==="
aws iam list-roles --query 'Roles[?contains(RoleName, `carelog`)].RoleName' --output text

echo "=== Secrets ==="
aws secretsmanager list-secrets --region $REGION \
    --query 'SecretList[?contains(Name, `carelog`)].Name' --output text

echo "=== CloudWatch ==="
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/carelog-dev \
    --query 'logGroups[].logGroupName' --output text --region $REGION
```

All should return empty. You are now ready for a clean deployment:

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

Then follow the setup guide at `docs/setup-and-deployment-guide.md` from section 5.3 onwards.
