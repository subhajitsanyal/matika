#!/usr/bin/env bash
# update-app-config.sh — Fetch live infrastructure values from AWS and update app configs
#
# Run after every `terraform apply` or when infrastructure changes.
# Updates: API base URL, Cognito pool/client IDs, S3 bucket name
#
# Usage:
#   ./scripts/update-app-config.sh              # uses defaults (dev, ap-south-1)
#   ./scripts/update-app-config.sh staging       # target a different environment
set -euo pipefail

ENV="${1:-dev}"
REGION="ap-south-1"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Fetching infrastructure config for '$ENV' from AWS ($REGION) ==="

# ─── Fetch values from AWS ──────────────────────────────────────

# API Gateway URL
API_GATEWAY_ID=$(aws apigateway get-rest-apis --region "$REGION" \
    --query "items[?name=='carelog-${ENV}-api'].id" --output text)
API_BASE_URL="https://${API_GATEWAY_ID}.execute-api.${REGION}.amazonaws.com/${ENV}"
echo "API Gateway URL: $API_BASE_URL"

# Cognito
COGNITO_USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region "$REGION" \
    --query "UserPools[?Name=='carelog-${ENV}-users'].Id" --output text)
COGNITO_APP_CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$COGNITO_USER_POOL_ID" \
    --region "$REGION" --query "UserPoolClients[0].ClientId" --output text)
COGNITO_WEB_DOMAIN="carelog-${ENV}.auth.${REGION}.amazoncognito.com"
echo "Cognito Pool: $COGNITO_USER_POOL_ID  Client: $COGNITO_APP_CLIENT_ID"

# S3 Bucket
S3_BUCKET_NAME=$(aws s3 ls | grep "carelog.*${ENV}.*documents" | awk '{print $3}')
echo "S3 Bucket: $S3_BUCKET_NAME"

# ─── Update Android config ──────────────────────────────────────

ANDROID_BUILDCONFIG="$PROJECT_ROOT/android/app/src/main/java/com/carelog/core/BuildConfig.kt"
ANDROID_AMPLIFY="$PROJECT_ROOT/android/app/src/main/res/raw/amplifyconfiguration.json"

echo ""
echo "Updating Android BuildConfig.kt..."
sed -i '' "s|const val API_BASE_URL = \".*\"|const val API_BASE_URL = \"${API_BASE_URL}\"|" "$ANDROID_BUILDCONFIG"

echo "Updating Android amplifyconfiguration.json..."
python3 -c "
import json
with open('$ANDROID_AMPLIFY') as f:
    config = json.load(f)
auth = config.get('auth', {}).get('plugins', {}).get('awsCognitoAuthPlugin', {})
pool = auth.get('CognitoUserPool', {}).get('Default', {})
pool['PoolId'] = '$COGNITO_USER_POOL_ID'
pool['AppClientId'] = '$COGNITO_APP_CLIENT_ID'
pool['Region'] = '$REGION'
oauth = auth.get('Auth', {}).get('Default', {}).get('OAuth', {})
if oauth:
    oauth['WebDomain'] = '$COGNITO_WEB_DOMAIN'
with open('$ANDROID_AMPLIFY', 'w') as f:
    json.dump(config, f, indent=2)
"

# ─── Update iOS config ──────────────────────────────────────────

IOS_AMPLIFY="$PROJECT_ROOT/ios/CareLog/CareLog/amplifyconfiguration.json"
if [ -f "$IOS_AMPLIFY" ]; then
    echo "Updating iOS amplifyconfiguration.json..."
    python3 -c "
import json
with open('$IOS_AMPLIFY') as f:
    config = json.load(f)
auth = config.get('auth', {}).get('plugins', {}).get('awsCognitoAuthPlugin', {})
pool = auth.get('CognitoUserPool', {}).get('Default', {})
pool['PoolId'] = '$COGNITO_USER_POOL_ID'
pool['AppClientId'] = '$COGNITO_APP_CLIENT_ID'
pool['Region'] = '$REGION'
oauth = auth.get('Auth', {}).get('Default', {}).get('OAuth', {})
if oauth:
    oauth['WebDomain'] = '$COGNITO_WEB_DOMAIN'
with open('$IOS_AMPLIFY', 'w') as f:
    json.dump(config, f, indent=2)
"
fi

# ─── Update build.gradle.kts (debug URL) ────────────────────────

GRADLE_FILE="$PROJECT_ROOT/android/app/build.gradle.kts"
echo "Updating build.gradle.kts debug API_BASE_URL..."
sed -i '' "s|buildConfigField(\"String\", \"API_BASE_URL\", \".*\")  *# debug|buildConfigField(\"String\", \"API_BASE_URL\", \"\\\\\"${API_BASE_URL}\\\\\"\") // debug|" "$GRADLE_FILE" 2>/dev/null || true

echo ""
echo "=== Done. Config updated for environment: $ENV ==="
echo ""
echo "Current values:"
echo "  API_BASE_URL:       $API_BASE_URL"
echo "  COGNITO_POOL_ID:    $COGNITO_USER_POOL_ID"
echo "  COGNITO_CLIENT_ID:  $COGNITO_APP_CLIENT_ID"
echo "  S3_BUCKET:          $S3_BUCKET_NAME"
echo ""
echo "Next steps:"
echo "  1. Rebuild the app:  cd android && ./gradlew assembleDebug"
echo "  2. Distribute:       bundle exec fastlane distribute_debug"
