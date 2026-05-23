#!/usr/bin/env bash
# Staging cleanup: wipe everything EXCEPT the John CG / Jane PT seed pair.
#
# Surgically resets the staging environment to a known-good baseline for an
# exhaustive bench run. Preserves:
#   - Cognito user sanyalsubhajit2010+cg@gmail.com  (John CG, caregiver)
#   - Cognito user sanyalsubhajit2010+pt9@gmail.com (Jane PT, patient, linked CL-012W6M)
#   - users row for John CG    (id f375ce5e-3d1b-4f6b-9c4f-e1fc1484f411)
#   - users row for Jane PT    (id 75564941-09f8-4381-b1e6-4554f23755e8)
#   - patients row for Jane    (id d4d38abb-af57-4658-a9e4-32b8701d12da, short CL-012W6M)
#   - persona_links row        (id 0bfb8a8e-0dd9-4a6d-b834-000806ede5ae, John ↔ Jane)
#   - parameter_configs        (7 rows for Jane: BP sys/dia, glucose, temp, weight, heart_rate, SpO2)
#   - system tables: topics, conversation_prompts                       (system data, not user)
#
# Wipes:
#   - All other Cognito users (~15 today)
#   - All other users / patients / persona_links / parameter_configs (cascade)
#   - All transactional rows: alerts, audit_log, interaction_sessions, model_call,
#     consent_records, device_tokens, attendant_invites, doctor_invites, patient_topics,
#     cost_telemetry, observation_sync_log
#   - All S3 keys under s3://carelog-v2-staging-documents-316643066568/observations/
#     EXCEPT the preserved Jane prefix (CL-012W6M/)
#
# Fix-ups:
#   - John CG's Cognito custom:linked_patient_id is forced to CL-012W6M
#     (currently CL-1RK0CD per the audit on 2026-05-23, which made the Android
#     app show the wrong patient on login).
#
# Pre-conditions (caller's responsibility):
#   - SSM tunnel open to staging RDS on localhost:55433. Open with:
#       aws ssm start-session --target i-0f2acdf1a96ee24a6 \
#         --document-name AWS-StartPortForwardingSessionToRemoteHost \
#         --parameters '{"host":["carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["55433"]}' \
#         --region ap-south-1 &
#   - aws CLI auth + region ap-south-1 default.
#   - /opt/homebrew/opt/libpq/bin/psql installed (Homebrew libpq).
#
# Usage:
#   scripts/matika-staging-cleanup.sh                # dry-run (default — prints what would happen)
#   scripts/matika-staging-cleanup.sh --execute      # actually delete
#   scripts/matika-staging-cleanup.sh --execute --yes  # skip the confirmation prompt
#   scripts/matika-staging-cleanup.sh --port 55434   # override psql port
#
# Exit codes:
#   0  success (dry-run printed plan, or execute completed cleanly)
#   1  pre-condition failure (tunnel down, missing tool, missing secret)
#   2  cleanup ran but at least one step errored — see output

set -euo pipefail

# ── Constants ─────────────────────────────────────────────
readonly USER_POOL_ID="ap-south-1_7cACPnKJn"
readonly REGION="ap-south-1"
readonly DB_SECRET="carelog-staging-db-password"
readonly DB_USER="carelog_staging_admin"
readonly DB_NAME="carelog_staging"
readonly S3_BUCKET="carelog-v2-staging-documents-316643066568"

readonly PRESERVE_COGNITO_EMAILS=(
    "sanyalsubhajit2010+cg@gmail.com"
    "sanyalsubhajit2010+pt9@gmail.com"
)
readonly PRESERVE_USER_IDS=(
    "f375ce5e-3d1b-4f6b-9c4f-e1fc1484f411"   # John CG
    "75564941-09f8-4381-b1e6-4554f23755e8"   # Jane PT
)
readonly PRESERVE_PATIENT_ID="d4d38abb-af57-4658-a9e4-32b8701d12da"
readonly PRESERVE_PATIENT_SHORT="CL-012W6M"
readonly JOHN_CG_COGNITO_SUB="51134dba-0041-70c0-ea5f-5c70348c3bb4"

readonly PSQL="/opt/homebrew/opt/libpq/bin/psql"

# ── Args ──────────────────────────────────────────────────
EXECUTE=0
SKIP_CONFIRM=0
DB_PORT=55433

while (( $# )); do
    case "$1" in
        --execute) EXECUTE=1 ;;
        --yes|-y)  SKIP_CONFIRM=1 ;;
        --port)    shift; DB_PORT="$1" ;;
        --help|-h)
            sed -n '2,/^$/p' "$0"
            exit 0
            ;;
        *)
            echo "ERROR: unknown flag '$1'" >&2; exit 2 ;;
    esac
    shift
done

# ── Pre-condition checks ──────────────────────────────────
if [[ ! -x "$PSQL" ]]; then
    echo "ERROR: $PSQL not found. brew install libpq" >&2
    exit 1
fi

if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "ERROR: aws CLI not authenticated" >&2
    exit 1
fi

# Probe the tunnel.
if ! (echo > "/dev/tcp/127.0.0.1/$DB_PORT") 2>/dev/null; then
    echo "ERROR: nothing listening on localhost:$DB_PORT. Open the SSM tunnel first." >&2
    echo "       aws ssm start-session --target i-0f2acdf1a96ee24a6 \\" >&2
    echo "         --document-name AWS-StartPortForwardingSessionToRemoteHost \\" >&2
    echo "         --parameters '{\"host\":[\"carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$DB_PORT\"]}' \\" >&2
    echo "         --region $REGION &" >&2
    exit 1
fi

# Pull the DB password.
PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id "$DB_SECRET" --region "$REGION" \
    --query SecretString --output text \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])")
export PGPASSWORD
trap 'unset PGPASSWORD' EXIT

psql_q() {
    "$PSQL" -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

# ── Pre-cleanup inventory ─────────────────────────────────
echo "▸ Pre-cleanup inventory (staging RDS)"
psql_q -q -c "
SELECT 'users'                    AS tbl, COUNT(*) AS n FROM users
UNION ALL SELECT 'patients',                COUNT(*) FROM patients
UNION ALL SELECT 'persona_links',           COUNT(*) FROM persona_links
UNION ALL SELECT 'parameter_configs',       COUNT(*) FROM parameter_configs
UNION ALL SELECT 'alerts',                  COUNT(*) FROM alerts
UNION ALL SELECT 'audit_log',               COUNT(*) FROM audit_log
UNION ALL SELECT 'attendant_invites',       COUNT(*) FROM attendant_invites
UNION ALL SELECT 'interaction_sessions',    COUNT(*) FROM interaction_sessions
UNION ALL SELECT 'model_call',              COUNT(*) FROM model_call
UNION ALL SELECT 'consent_records',         COUNT(*) FROM consent_records
UNION ALL SELECT 'device_tokens',           COUNT(*) FROM device_tokens
UNION ALL SELECT 'patient_topics',          COUNT(*) FROM patient_topics
UNION ALL SELECT 'cost_telemetry',          COUNT(*) FROM cost_telemetry
ORDER BY tbl;"
echo

echo "▸ Cognito users currently in pool ($USER_POOL_ID):"
aws cognito-idp list-users --user-pool-id "$USER_POOL_ID" --region "$REGION" \
    --query 'Users[].[Attributes[?Name==`email`].Value|[0], UserStatus, Enabled]' \
    --output table | head -25
echo

echo "▸ Preserve list:"
echo "    Cognito emails:    ${PRESERVE_COGNITO_EMAILS[*]}"
echo "    users.id rows:     ${PRESERVE_USER_IDS[*]}"
echo "    patients.id:       $PRESERVE_PATIENT_ID  ($PRESERVE_PATIENT_SHORT)"
echo "    parameter_configs: all 7 rows for that patient"
echo "    system tables (always preserved): topics, conversation_prompts"
echo
echo "▸ Fix-up: John CG Cognito custom:linked_patient_id → $PRESERVE_PATIENT_SHORT"
echo

if [[ $EXECUTE -eq 0 ]]; then
    echo "▸ DRY RUN — no changes will be made. Re-run with --execute to apply."
    echo
    echo "▸ Counts that WOULD be reduced (computed against current preserve list):"
    psql_q -q -c "
WITH preserve_users AS (SELECT unnest(ARRAY['${PRESERVE_USER_IDS[0]}'::uuid, '${PRESERVE_USER_IDS[1]}'::uuid]) AS id)
SELECT 'users'         AS tbl, COUNT(*) AS keep, (SELECT COUNT(*) FROM users) - COUNT(*) AS wipe
  FROM users WHERE id IN (SELECT id FROM preserve_users)
UNION ALL
SELECT 'patients',     1, (SELECT COUNT(*) FROM patients) - 1
UNION ALL
SELECT 'persona_links', 1, (SELECT COUNT(*) FROM persona_links) - 1
UNION ALL
SELECT 'parameter_configs', 7, (SELECT COUNT(*) FROM parameter_configs) - 7
ORDER BY tbl;"
    exit 0
fi

# ── Confirmation prompt ───────────────────────────────────
if [[ $SKIP_CONFIRM -eq 0 ]]; then
    echo "▸ About to WIPE staging data (this is destructive — DB rows + Cognito users + S3 keys)."
    read -rp "    Type 'CLEAN' to proceed: " CONFIRM
    if [[ "$CONFIRM" != "CLEAN" ]]; then
        echo "Aborted." >&2; exit 1
    fi
fi

echo "▸ Executing cleanup…"

# ── Phase 1: truncate transactional tables ────────────────
# These tables hold per-session / per-event data that we don't want to
# preserve across the bench reset. Order matters for FK dependencies but
# TRUNCATE ... CASCADE handles it.
echo "  ◦ Truncating transactional tables…"
psql_q -q <<'SQL'
BEGIN;
TRUNCATE TABLE
    alerts,
    audit_log,
    attendant_invites,
    doctor_invites,
    interaction_sessions,
    model_call,
    consent_records,
    device_tokens,
    patient_topics,
    cost_telemetry,
    observation_sync_log,
    deletion_requests,
    data_export_requests,
    documents,
    observation_notes,
    recommendations,
    reminder_configs,
    thresholds,
    care_plans,
    vision_results,
    email_suppression
CASCADE;
COMMIT;
SQL

# ── Phase 2: delete non-preserved parameter_configs ───────
echo "  ◦ Deleting parameter_configs for non-preserved patients…"
psql_q -q -c "
DELETE FROM parameter_configs
WHERE patient_id <> '$PRESERVE_PATIENT_ID'::uuid;"

# ── Phase 3: delete non-preserved persona_links ───────────
echo "  ◦ Deleting non-preserved persona_links…"
psql_q -q -c "
DELETE FROM persona_links
WHERE patient_id <> '$PRESERVE_PATIENT_ID'::uuid
   OR linked_user_id NOT IN (
        '${PRESERVE_USER_IDS[0]}'::uuid,
        '${PRESERVE_USER_IDS[1]}'::uuid
   );"

# ── Phase 4: delete non-preserved patients ────────────────
# CASCADE cleans up the patient-side users via the FK chain.
echo "  ◦ Deleting non-preserved patients…"
psql_q -q -c "
DELETE FROM patients
WHERE id <> '$PRESERVE_PATIENT_ID'::uuid;"

# ── Phase 5: delete non-preserved users ───────────────────
echo "  ◦ Deleting non-preserved users…"
psql_q -q -c "
DELETE FROM users
WHERE id NOT IN (
    '${PRESERVE_USER_IDS[0]}'::uuid,
    '${PRESERVE_USER_IDS[1]}'::uuid
);"

# ── Phase 6: Cognito wipe ─────────────────────────────────
echo "  ◦ Wiping Cognito users (preserve list: ${PRESERVE_COGNITO_EMAILS[*]})…"
PRESERVE_REGEX=$(printf '|%s' "${PRESERVE_COGNITO_EMAILS[@]}")
PRESERVE_REGEX="${PRESERVE_REGEX:1}"
COG_USERS=$(aws cognito-idp list-users --user-pool-id "$USER_POOL_ID" --region "$REGION" \
    --query 'Users[].[Username, Attributes[?Name==`email`].Value|[0]]' --output text)
DELETED=0
while IFS=$'\t' read -r USERNAME EMAIL; do
    [[ -z "$USERNAME" ]] && continue
    if [[ "$EMAIL" =~ ^(${PRESERVE_REGEX})$ ]]; then
        echo "    ✓ preserve $EMAIL"
        continue
    fi
    echo "    × delete  $EMAIL ($USERNAME)"
    aws cognito-idp admin-delete-user \
        --user-pool-id "$USER_POOL_ID" \
        --region "$REGION" \
        --username "$USERNAME" >/dev/null
    DELETED=$((DELETED + 1))
done <<< "$COG_USERS"
echo "    Cognito users deleted: $DELETED"

# ── Phase 7: S3 wipe ──────────────────────────────────────
echo "  ◦ Wiping S3 observations except observations/$PRESERVE_PATIENT_SHORT/…"
S3_DELETED=0
while IFS= read -r KEY; do
    [[ -z "$KEY" ]] && continue
    if [[ "$KEY" == observations/$PRESERVE_PATIENT_SHORT/* ]]; then
        continue
    fi
    aws s3 rm "s3://$S3_BUCKET/$KEY" --region "$REGION" >/dev/null
    S3_DELETED=$((S3_DELETED + 1))
done < <(aws s3 ls "s3://$S3_BUCKET/observations/" --recursive --region "$REGION" \
    | awk '{print $4}')
echo "    S3 keys deleted: $S3_DELETED"

# ── Phase 8: fix-up John CG's linked_patient_id ──────────
echo "  ◦ Setting John CG Cognito custom:linked_patient_id → $PRESERVE_PATIENT_SHORT…"
aws cognito-idp admin-update-user-attributes \
    --user-pool-id "$USER_POOL_ID" \
    --region "$REGION" \
    --username "$JOHN_CG_COGNITO_SUB" \
    --user-attributes Name=custom:linked_patient_id,Value="$PRESERVE_PATIENT_SHORT" \
    >/dev/null
echo "    ✓ updated"

# ── Post-cleanup inventory ────────────────────────────────
echo
echo "▸ Post-cleanup inventory:"
psql_q -q -c "
SELECT 'users'                    AS tbl, COUNT(*) AS n FROM users
UNION ALL SELECT 'patients',                COUNT(*) FROM patients
UNION ALL SELECT 'persona_links',           COUNT(*) FROM persona_links
UNION ALL SELECT 'parameter_configs',       COUNT(*) FROM parameter_configs
UNION ALL SELECT 'alerts',                  COUNT(*) FROM alerts
UNION ALL SELECT 'audit_log',               COUNT(*) FROM audit_log
UNION ALL SELECT 'attendant_invites',       COUNT(*) FROM attendant_invites
UNION ALL SELECT 'interaction_sessions',    COUNT(*) FROM interaction_sessions
UNION ALL SELECT 'model_call',              COUNT(*) FROM model_call
ORDER BY tbl;"

echo
echo "✓ Staging cleanup complete. John CG + Jane PT seed pair preserved."
echo "  Next step: run scripts/matika-staging-bench-run.sh or follow"
echo "             docs/bench-orchestrator-runbook.md."
