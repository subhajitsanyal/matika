#!/usr/bin/env bash
# cognito-test-harness.sh — Stream C: Cognito email-intercept harness
# (option C from launch-plan §4.3).
#
# The dev Cognito user pool sends a real OTP email on `cognito-idp sign-up`
# and a real temporary-password email on `admin-create-user` (default
# MessageAction). Automated tests can't read either, so the harness uses
# the Cognito admin API to either confirm the user server-side
# (`admin-confirm-sign-up`) or pre-create a known-temp-password user
# with `MessageAction=SUPPRESS`. Either path triggers the same
# post-confirmation Lambda the production flow does.
#
# Usage (source-then-call):
#   source test-automation/scripts/cognito-test-harness.sh
#   harness_init                                # resolves pool + client IDs
#   harness_admin_confirm_signup user@x.com     # for self-signup journeys (CG-V2-01, PT-V2-23)
#   harness_admin_create_force_change_password_user user@x.com TempP@ss caregiver
#                                               # for invited-user journeys (EDGE-V2-04)
#   harness_admin_get_user user@x.com           # inspect Cognito state
#   harness_admin_delete_user user@x.com        # cleanup
#
# Pre-conditions:
#   AWS credentials available (either env, profile, or instance role).
#   Region defaults to ap-south-1 — set AWS_REGION to override.
#
# Why this lives at test-automation/scripts/, not scripts/:
#   it's strictly a test fixture (not a deploy or smoke-test tool).
#   The .maestro/ wrapper at scripts/cognito-harness-maestro.sh sources
#   this and does the multi-phase Maestro orchestration.

set -euo pipefail

HARNESS_REGION="${AWS_REGION:-ap-south-1}"
HARNESS_POOL_ID="${COGNITO_POOL_ID:-}"
HARNESS_CLIENT_ID="${COGNITO_CLIENT_ID:-}"

# Resolve the dev pool ID + mobile client ID once. Mirrors seed-accounts.sh's
# dynamic lookup so the harness works on any laptop without hardcoded IDs.
harness_init() {
    if [[ -z "$HARNESS_POOL_ID" ]]; then
        HARNESS_POOL_ID="$(aws cognito-idp list-user-pools \
            --max-results 10 --region "$HARNESS_REGION" \
            --query 'UserPools[?contains(Name,`carelog`)].Id | [0]' \
            --output text 2>/dev/null)"
    fi
    if [[ -z "$HARNESS_POOL_ID" || "$HARNESS_POOL_ID" == "None" ]]; then
        echo "harness_init: failed to resolve Cognito user pool in $HARNESS_REGION" >&2
        return 1
    fi

    if [[ -z "$HARNESS_CLIENT_ID" ]]; then
        HARNESS_CLIENT_ID="$(aws cognito-idp list-user-pool-clients \
            --user-pool-id "$HARNESS_POOL_ID" --region "$HARNESS_REGION" \
            --query 'UserPoolClients[?contains(ClientName,`mobile`)].ClientId | [0]' \
            --output text 2>/dev/null)"
    fi
    if [[ -z "$HARNESS_CLIENT_ID" || "$HARNESS_CLIENT_ID" == "None" ]]; then
        echo "harness_init: failed to resolve mobile app client" >&2
        return 1
    fi

    echo "harness_init: pool=$HARNESS_POOL_ID client=$HARNESS_CLIENT_ID region=$HARNESS_REGION" >&2
    export HARNESS_POOL_ID HARNESS_CLIENT_ID HARNESS_REGION
}

# Confirm a user that signed up through the app's UI (Amplify SignUp).
# Triggers PostConfirmation_ConfirmSignUp — same path as a real OTP confirmation,
# so the post-confirmation Lambda runs (group assignment + users-row insert).
harness_admin_confirm_signup() {
    local email="$1"
    aws cognito-idp admin-confirm-sign-up \
        --user-pool-id "$HARNESS_POOL_ID" \
        --username "$email" \
        --region "$HARNESS_REGION" >&2
    # Belt-and-braces: mark email_verified=true. admin-confirm-sign-up sets
    # the user state to CONFIRMED but does NOT flip email_verified, and some
    # downstream code paths gate on the attribute, not the user status.
    aws cognito-idp admin-update-user-attributes \
        --user-pool-id "$HARNESS_POOL_ID" \
        --username "$email" \
        --user-attributes Name=email_verified,Value=true \
        --region "$HARNESS_REGION" >&2
    echo "harness: confirmed $email" >&2
}

# Create an invited-user with a known temp password and MessageAction=SUPPRESS
# (no email sent). User starts in FORCE_CHANGE_PASSWORD state — first sign-in
# returns the NEW_PASSWORD_REQUIRED challenge. EDGE-V2-04 needs this shape.
#
# NOTE: as of 2026-05-13 the Android app (AuthRepository.signIn()) does NOT
# handle the NEW_PASSWORD_REQUIRED next-step — sign-in fails with
# "Sign in incomplete: ${nextStep}". This helper is the test-side ready;
# the app-side change is a separate work item.
harness_admin_create_force_change_password_user() {
    local email="$1" temp_password="$2" persona="${3:-caregiver}" name="${4:-Stream C Edge Test}"
    # `name` is a REQUIRED attribute on this Cognito user pool; if it's
    # not set at admin-create-user time, the later confirmSignIn call
    # (resolving the NEW_PASSWORD_REQUIRED challenge) fails with
    # `InvalidParameterException: One or more parameters are incorrect.`
    aws cognito-idp admin-create-user \
        --user-pool-id "$HARNESS_POOL_ID" \
        --username "$email" \
        --user-attributes \
            Name=email,Value="$email" \
            Name=email_verified,Value=true \
            Name=name,Value="$name" \
            Name="custom:persona_type",Value="$persona" \
        --temporary-password "$temp_password" \
        --message-action SUPPRESS \
        --region "$HARNESS_REGION" >&2
    echo "harness: created FORCE_CHANGE_PASSWORD user $email (persona=$persona)" >&2
}

# Inspect a user's Cognito state. Useful for verifying the harness landed
# the user in the expected status (CONFIRMED / FORCE_CHANGE_PASSWORD / etc.).
harness_admin_get_user() {
    local email="$1"
    aws cognito-idp admin-get-user \
        --user-pool-id "$HARNESS_POOL_ID" \
        --username "$email" \
        --region "$HARNESS_REGION"
}

# Delete a user. Idempotent: returns 0 even if the user never existed.
harness_admin_delete_user() {
    local email="$1"
    aws cognito-idp admin-delete-user \
        --user-pool-id "$HARNESS_POOL_ID" \
        --username "$email" \
        --region "$HARNESS_REGION" 2>/dev/null || true
    echo "harness: deleted $email" >&2
}

# Generate a Cognito-unique test email for a self-registration run.
# Pattern matches generate_patient_email.js so cleanup helpers can grep both.
harness_generate_test_email() {
    local persona_prefix="${1:-cg}"
    local base="${MATIKA_TEST_EMAIL_BASE:-sanyalsubhajit2010}"
    local stamp
    stamp="$(date +%s | tail -c 7)"
    echo "${base}+${persona_prefix}-${stamp}@gmail.com"
}

# When sourced, just announce. Callers invoke harness_init explicitly.
echo "cognito-test-harness.sh loaded. Call harness_init to resolve pool/client IDs." >&2
