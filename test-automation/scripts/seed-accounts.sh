#!/usr/bin/env bash
# seed-accounts.sh — Create and confirm test accounts via Cognito admin API
# Usage: source seed-accounts.sh && seed_all_accounts
set -euo pipefail

POOL_ID="ap-south-1_uiEZhWVXB"
CLIENT_ID="1kjdqj21bljak87e602d8r84f2"
REGION="ap-south-1"
TEST_PASSWORD="Carelog2026@x"
CREDS_FILE="${CREDS_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/test-data/credentials.json}"
RUN_ID="${RUN_ID:-$(date +%s)}"

# Create a Cognito user, set password, and confirm
create_user() {
    local email="$1"
    local name="$2"
    local persona="$3"

    echo "Creating user: $email (persona=$persona)"

    # Sign up via Cognito API (creates user in UNCONFIRMED state)
    aws cognito-idp sign-up \
        --client-id "$CLIENT_ID" \
        --username "$email" \
        --password "$TEST_PASSWORD" \
        --user-attributes \
            Name=email,Value="$email" \
            Name=name,Value="$name" \
            Name="custom:persona_type",Value="$persona" \
        --region "$REGION" 2>&1 || true

    # Admin-confirm the user (bypasses email verification)
    aws cognito-idp admin-confirm-sign-up \
        --user-pool-id "$POOL_ID" \
        --username "$email" \
        --region "$REGION" 2>&1

    # Add user to the correct group
    local group="${persona}s"  # patients, relatives, attendants, doctors
    aws cognito-idp admin-add-user-to-group \
        --user-pool-id "$POOL_ID" \
        --username "$email" \
        --group-name "$group" \
        --region "$REGION" 2>&1 || echo "  (group $group may not exist yet)"

    echo "  Confirmed: $email"
}

# Seed all test accounts for a full test run
seed_all_accounts() {
    local relative_email="relative.${RUN_ID}@carelog.test"
    local patient_email="patient.${RUN_ID}@carelog.test"
    local attendant_email="attendant.${RUN_ID}@carelog.test"

    echo "=== Seeding test accounts (run $RUN_ID) ==="

    create_user "$relative_email" "Test Relative ${RUN_ID}" "relative"
    create_user "$patient_email" "Test Patient ${RUN_ID}" "patient"
    create_user "$attendant_email" "Test Attendant ${RUN_ID}" "attendant"

    # Link patient to relative via custom attribute
    aws cognito-idp admin-update-user-attributes \
        --user-pool-id "$POOL_ID" \
        --username "$patient_email" \
        --user-attributes Name="custom:linked_patient_id",Value="patient_${RUN_ID}" \
        --region "$REGION" 2>&1 || true

    # Write credentials file
    cat > "$CREDS_FILE" <<EOF
{
  "run_id": "${RUN_ID}",
  "password": "${TEST_PASSWORD}",
  "relative": {
    "email": "${relative_email}",
    "name": "Test Relative ${RUN_ID}"
  },
  "patient": {
    "email": "${patient_email}",
    "name": "Test Patient ${RUN_ID}"
  },
  "attendant": {
    "email": "${attendant_email}",
    "name": "Test Attendant ${RUN_ID}"
  }
}
EOF

    echo "=== Credentials saved to $CREDS_FILE ==="
    cat "$CREDS_FILE"
}

# Confirm a user that was created through the app's registration flow
confirm_app_user() {
    local email="$1"
    echo "Admin-confirming app-registered user: $email"
    aws cognito-idp admin-confirm-sign-up \
        --user-pool-id "$POOL_ID" \
        --username "$email" \
        --region "$REGION" 2>&1
    echo "  Confirmed."
}

# Clean up test accounts after a run
cleanup_accounts() {
    local creds_file="${1:-$CREDS_FILE}"
    if [ ! -f "$creds_file" ]; then
        echo "No credentials file found at $creds_file"
        return 1
    fi

    for email in $(python3 -c "import json; d=json.load(open('$creds_file')); [print(d[k]['email']) for k in ('relative','patient','attendant') if k in d]"); do
        echo "Deleting user: $email"
        aws cognito-idp admin-delete-user \
            --user-pool-id "$POOL_ID" \
            --username "$email" \
            --region "$REGION" 2>&1 || echo "  (already deleted or not found)"
    done
    echo "Cleanup complete."
}

echo "seed-accounts.sh loaded. RUN_ID=$RUN_ID"
