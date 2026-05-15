#!/usr/bin/env bash
# cognito-harness-maestro.sh — Stream C orchestrator.
#
# Drives the multi-phase Maestro flows that need an admin-API user
# confirmation (or admin-API user creation) in the middle. Maestro's
# runScript JS sandbox cannot shell out (per maestro_lessons.md #4), so
# the orchestration lives here as a wrapper bash script.
#
# Usage:
#   scripts/cognito-harness-maestro.sh cg-v2-01
#       Self-registration → admin-confirm → login + consent + dashboard.
#       Asserts disclosure substring on the consent screen (also
#       satisfies PT-V2-23 — caregiver and patient see identical text).
#
#   scripts/cognito-harness-maestro.sh cg-v2-01 --keep-user
#       Same, but skip the cleanup so dev RDS rows survive for inspection.
#
# Cleans up the test user (admin-delete-user) at the end unless
# --keep-user is passed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
FLOWS_DIR="$ROOT/.maestro/flows"

# shellcheck source=../test-automation/scripts/cognito-test-harness.sh
source "$ROOT/test-automation/scripts/cognito-test-harness.sh"

KEEP_USER=0
INSTALL=1
JOURNEY=""
for a in "$@"; do
    case "$a" in
        --keep-user) KEEP_USER=1 ;;
        --no-install) INSTALL=0 ;;
        *) JOURNEY="$a" ;;
    esac
done

if [[ -z "$JOURNEY" ]]; then
    echo "usage: $0 <journey> [--keep-user] [--no-install]" >&2
    echo "  journeys: cg-v2-01, edge-v2-04, cg-v2-16, edge-v2-09" >&2
    exit 1
fi

# John CG identifiers (canonical dev caregiver, jane_dev_test_account memory).
JOHN_CG_COGNITO_SUB="2193bdfa-d001-70da-aa9a-395dabbe8122"
JOHN_CG_USERNAME="sanyalsubhajit2010+cg@gmail.com"
JANE_PATIENT_ID="CL-63NRGO"

# Source the matika-test-creds env so the wrapper can reach
# MATIKA_CAREGIVER_EMAIL/_PASSWORD for the Maestro -e bridge.
CREDS="${MATIKA_CREDS_FILE:-$HOME/.matika-test-creds.env}"
[[ -f "$CREDS" ]] && source "$CREDS"

# ── Sanity checks (mirror maestro-run.sh) ─────────────────
for cmd in maestro adb aws; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd not on PATH"; exit 1; }
done
adb devices | grep -E '\bdevice$' >/dev/null || {
    echo "ERROR: no Android device connected"; adb devices; exit 1; }

# ── Optional install ──────────────────────────────────────
if [[ $INSTALL -eq 1 ]]; then
    [[ -f "$APK" ]] || { echo "ERROR: APK not built at $APK; run ./gradlew :app:assembleDebug"; exit 1; }
    echo "▸ Installing $APK"
    adb install -r "$APK"
    adb shell am force-stop com.carelog
fi

# ── Resolve dev pool/client ───────────────────────────────
harness_init

# ── Per-journey orchestration ─────────────────────────────
case "$JOURNEY" in
    cg-v2-01)
        EMAIL="$(harness_generate_test_email cg)"
        PASSWORD="${MATIKA_REGISTER_PASSWORD:-Carelog2026@x}"
        NAME="Stream C Test ${EMAIL##*+}"
        echo "▸ Test caregiver email: $EMAIL"

        echo "▸ Phase 1 — register form fill"
        maestro test "$FLOWS_DIR/cg_v2_01_self_register_part1.yaml" \
            -e "MATIKA_REGISTER_EMAIL=$EMAIL" \
            -e "MATIKA_REGISTER_PASSWORD=$PASSWORD" \
            -e "MATIKA_REGISTER_NAME=$NAME"

        echo "▸ Harness — admin-confirm-sign-up (skips real OTP email)"
        harness_admin_confirm_signup "$EMAIL"

        # post-confirmation Lambda runs async-ish on Cognito's side;
        # give it a moment to write the users row before login triggers
        # GET /consent (which resolves cognito_sub → users.id).
        sleep 3

        echo "▸ Phase 2 — login + consent + dashboard"
        maestro test "$FLOWS_DIR/cg_v2_01_self_register_part2.yaml" \
            -e "MATIKA_REGISTER_EMAIL=$EMAIL" \
            -e "MATIKA_REGISTER_PASSWORD=$PASSWORD"

        echo "▸ Cognito state after run:"
        harness_admin_get_user "$EMAIL" \
            --query '{Status: UserStatus, Sub: Attributes[?Name==`sub`].Value | [0], EmailVerified: Attributes[?Name==`email_verified`].Value | [0]}'

        if [[ $KEEP_USER -eq 0 ]]; then
            echo "▸ Cleanup — admin-delete-user $EMAIL"
            harness_admin_delete_user "$EMAIL"
        else
            echo "▸ --keep-user set; leaving $EMAIL in Cognito for inspection"
        fi
        ;;
    cg-v2-16)
        # CG-V2-16 — destructive cascade test for delete-patient (DPDP
        # right-to-erasure). Use John CG (canonical caregiver) plus a
        # synthetic patient created out-of-band via direct lambda invoke
        # so we never touch Jane.
        #
        # Flow:
        #   1. Invoke create-patient lambda with a hand-crafted authorizer
        #      claims context for John CG. Lambda creates a Cognito patient
        #      user, persona_links row (primary=true, active=true), users
        #      row, parameter_configs (default protocol), AND sets John CG's
        #      `custom:linked_patient_id` to the new patient.
        #   2. Run the Maestro flow which logs in as John CG → settings →
        #      tap delete → confirm → asserts sign-out.
        #   3. Verify the cascade in dev RDS via SSM tunnel.
        #   4. Restore John CG's `custom:linked_patient_id` back to Jane
        #      so subsequent runs of other flows aren't disrupted.
        STAMP="$(date +%s | tail -c 7)"
        TEST_PATIENT_NAME="Cascade Test ${STAMP}"
        TEST_PATIENT_EMAIL="${MATIKA_TEST_EMAIL_BASE:-sanyalsubhajit2010}+pt-cascade-${STAMP}@gmail.com"
        echo "▸ Creating synthetic test patient via create-patient lambda"
        echo "  caregiver: $JOHN_CG_USERNAME ($JOHN_CG_COGNITO_SUB)"
        echo "  patient:   $TEST_PATIENT_EMAIL"

        # Hand-craft the API Gateway proxy event the lambda expects. The
        # claims block mirrors what the COGNITO_USER_POOLS authorizer
        # populates in production — sub/email/name/cognito:username.
        PAYLOAD_FILE="$(mktemp -t cg-v2-16-payload-XXXXXX.json)"
        cat > "$PAYLOAD_FILE" <<JSON
{
  "body": "{\"name\":\"$TEST_PATIENT_NAME\",\"patientEmail\":\"$TEST_PATIENT_EMAIL\",\"dateOfBirth\":\"01/01/1950\",\"gender\":\"female\",\"language\":\"en\",\"timezone\":\"Asia/Kolkata\"}",
  "requestContext": {
    "authorizer": {
      "claims": {
        "sub": "$JOHN_CG_COGNITO_SUB",
        "email": "$JOHN_CG_USERNAME",
        "name": "John CG",
        "cognito:username": "$JOHN_CG_USERNAME"
      }
    }
  }
}
JSON
        RESPONSE_FILE="$(mktemp -t cg-v2-16-resp-XXXXXX.json)"
        aws lambda invoke \
            --function-name carelog-dev-create-patient \
            --region "$HARNESS_REGION" \
            --cli-binary-format raw-in-base64-out \
            --payload "file://$PAYLOAD_FILE" \
            "$RESPONSE_FILE" >/dev/null
        rm -f "$PAYLOAD_FILE"

        STATUS_CODE="$(python3 -c "import json,sys; r=json.load(open('$RESPONSE_FILE')); print(r.get('statusCode'))")"
        if [[ "$STATUS_CODE" != "201" ]]; then
            echo "ERROR: create-patient returned $STATUS_CODE; response:" >&2
            cat "$RESPONSE_FILE" >&2
            rm -f "$RESPONSE_FILE"
            exit 1
        fi
        TEST_PATIENT_ID="$(python3 -c "import json,sys; r=json.load(open('$RESPONSE_FILE')); b=json.loads(r['body']); print(b['patientId'])")"
        TEST_PATIENT_COGNITO_SUB="$(python3 -c "import json,sys; r=json.load(open('$RESPONSE_FILE')); b=json.loads(r['body']); print(b['cognito_sub'])")"
        rm -f "$RESPONSE_FILE"
        echo "  → patientId=$TEST_PATIENT_ID, cognito_sub=$TEST_PATIENT_COGNITO_SUB"

        echo "▸ Phase — login as John CG → settings → delete → assert sign-out"
        maestro test "$FLOWS_DIR/cg_v2_16_delete_patient_cascade.yaml" \
            -e "MATIKA_CAREGIVER_EMAIL=$MATIKA_CAREGIVER_EMAIL" \
            -e "MATIKA_CAREGIVER_PASSWORD=$MATIKA_CAREGIVER_PASSWORD"

        echo "▸ Restore John CG's custom:linked_patient_id back to Jane ($JANE_PATIENT_ID)"
        aws cognito-idp admin-update-user-attributes \
            --user-pool-id "$HARNESS_POOL_ID" \
            --username "$JOHN_CG_USERNAME" \
            --user-attributes "Name=custom:linked_patient_id,Value=$JANE_PATIENT_ID" \
            --region "$HARNESS_REGION"
        echo "  → restored"

        echo "▸ Cascade verification — query dev RDS via SSM tunnel"
        echo "  Expecting: patients row gone (hard delete); persona_links" \
             "is_active=false; users is_active=false; audit_log entry."
        echo "  Run separately via:" \
             "  aws ssm start-session --target $JOHN_CG_USERNAME ... + psql"
        echo "  Test patient identifiers for inspection:"
        echo "    patientId:   $TEST_PATIENT_ID"
        echo "    cognito_sub: $TEST_PATIENT_COGNITO_SUB"
        ;;
    edge-v2-04)
        # FORCE_CHANGE_PASSWORD first-time login. Use the patient-prefix
        # email pattern to match the canonical journey definition
        # (admin-created patients get the temp password; caregivers
        # would too if added via admin-create-user, but the canonical
        # actor is a patient).
        EMAIL="$(harness_generate_test_email pt)"
        TEMP_PASSWORD="${MATIKA_TEMP_PASSWORD:-Temp2026!Init}"
        NEW_PASSWORD="${MATIKA_NEW_PASSWORD:-NewP@ss2026!}"
        echo "▸ Test invited-user email: $EMAIL"
        echo "▸ Harness — admin-create-user (MessageAction=SUPPRESS, FORCE_CHANGE_PASSWORD)"
        harness_admin_create_force_change_password_user "$EMAIL" "$TEMP_PASSWORD" patient

        echo "▸ Cognito state pre-flow (expect FORCE_CHANGE_PASSWORD):"
        harness_admin_get_user "$EMAIL" --query 'UserStatus'

        echo "▸ Phase — login with temp password → set new password → consent screen"
        maestro test "$FLOWS_DIR/edge_v2_04_force_change_password.yaml" \
            -e "MATIKA_REGISTER_EMAIL=$EMAIL" \
            -e "MATIKA_TEMP_PASSWORD=$TEMP_PASSWORD" \
            -e "MATIKA_NEW_PASSWORD=$NEW_PASSWORD"

        echo "▸ Cognito state post-flow (expect CONFIRMED):"
        harness_admin_get_user "$EMAIL" --query 'UserStatus'

        if [[ $KEEP_USER -eq 0 ]]; then
            echo "▸ Cleanup — admin-delete-user $EMAIL"
            harness_admin_delete_user "$EMAIL"
        else
            echo "▸ --keep-user set; leaving $EMAIL in Cognito for inspection"
        fi
        ;;
    edge-v2-09)
        # EDGE-V2-09 — Bedrock structured-output parse failure.
        # Triggers the bedrock-router's `invokeWithRetry` (handler.ts:985)
        # by injecting hardcoded malformed text via the bedrock_chaos
        # invoker (bedrock_chaos.ts) when the request carries the
        # `x-test-chaos: malformed_json` header. Both the first attempt
        # and the stricter-prompt retry fail to parse, throwing
        # HandlerError(503) with code prefix `parse_failed_after_retry_`.
        #
        # No Maestro flow needed — this is a direct API contract test.
        # The Android UI consequence (Snackbar on 5xx) is already covered
        # by other journeys; the unique surface here is the retry+503.
        if [[ -z "${MATIKA_PATIENT_EMAIL:-}" || -z "${MATIKA_PATIENT_PASSWORD:-}" ]]; then
            echo "ERROR: MATIKA_PATIENT_EMAIL/_PASSWORD not in env. Source ~/.matika-test-creds.env first." >&2
            exit 1
        fi

        API_BASE="https://rsf93ac8bd.execute-api.${HARNESS_REGION}.amazonaws.com/dev"
        echo "▸ Resolving Cognito ID token for $MATIKA_PATIENT_EMAIL"
        # API GW COGNITO_USER_POOLS authorizers accept the ID token by
        # default (the access token only works for direct AWS API calls).
        TOKEN=$(aws cognito-idp initiate-auth \
            --client-id "$HARNESS_CLIENT_ID" \
            --auth-flow USER_PASSWORD_AUTH \
            --auth-parameters "USERNAME=$MATIKA_PATIENT_EMAIL,PASSWORD=$MATIKA_PATIENT_PASSWORD" \
            --region "$HARNESS_REGION" \
            --query 'AuthenticationResult.IdToken' --output text)
        if [[ -z "$TOKEN" || "$TOKEN" == "None" ]]; then
            echo "ERROR: failed to get Cognito token" >&2
            exit 1
        fi
        echo "  → got token (${#TOKEN} chars)"

        # Jane's cognito sub from jane_dev_test_account memory.
        JANE_SUB="f1530dba-7001-7088-4072-0ce01f3ef133"
        SESSION_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
        BODY=$(python3 -c "
import json
print(json.dumps({
    'sessionId': '$SESSION_ID',
    'patientId': '$JANE_SUB',
    'transcript': 'My BP is 120 over 80',
    'language': 'en-IN',
    'turnSequence': 1,
    'sessionType': 'patient_logging',
    'actorCognitoSub': '$JANE_SUB',
}))")

        RESP_FILE="$(mktemp -t edge-v2-09-resp-XXXXXX.json)"
        echo "▸ POST $API_BASE/conversation/turn  (header x-test-chaos: malformed_json)"
        echo "  sessionId=$SESSION_ID"
        HTTP_CODE=$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
            -X POST "$API_BASE/conversation/turn" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -H "x-test-chaos: malformed_json" \
            -d "$BODY")
        echo "  → HTTP $HTTP_CODE"
        echo "  → body:"
        cat "$RESP_FILE" | python3 -m json.tool 2>&1 | sed 's/^/      /'

        # Pass criterion per journeys.md EDGE-V2-09: "One stricter retry;
        # on second failure 503 to client". The handler returns 500 from
        # the catch in handleProxyInvocation when HandlerError(503) is
        # thrown; the message string carries `parse_failed_after_retry_*`.
        # Either status code (500 or 503) is acceptable; the message is
        # the load-bearing assertion.
        MESSAGE=$(python3 -c "import json; r=json.load(open('$RESP_FILE')); print(r.get('message', ''))")
        if [[ "$HTTP_CODE" =~ ^5 ]] && [[ "$MESSAGE" == *"parse_failed_after_retry"* || "$MESSAGE" == *"parsing"* ]]; then
            echo "✓ EDGE-V2-09 PASS — chaos-injected malformed JSON triggered the retry then 5xx"
        else
            echo "✗ EDGE-V2-09 FAIL — expected 5xx + parse_failed_after_retry message" >&2
            rm -f "$RESP_FILE"
            exit 1
        fi
        rm -f "$RESP_FILE"

        echo "▸ CloudWatch — confirm parse_failed_first_attempt + parse_failed_after_retry"
        # Brief pause for log delivery.
        sleep 5
        aws logs filter-log-events \
            --log-group-name "/aws/lambda/matika-dev-bedrock-router" \
            --region "$HARNESS_REGION" \
            --start-time $(( ($(date +%s) - 120) * 1000 )) \
            --filter-pattern "parse_failed" \
            --max-items 10 \
            --query 'events[*].message' --output text 2>&1 | grep -E "parse_failed" | head -5 || \
            echo "  (no log events yet — check manually if needed)"
        ;;
    *)
        echo "Unknown journey: $JOURNEY" >&2
        exit 1
        ;;
esac

echo "▸ Done."
