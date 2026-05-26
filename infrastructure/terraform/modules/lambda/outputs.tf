output "post_confirmation_arn" {
  value = aws_lambda_function.post_confirmation.arn
}

output "post_authentication_arn" {
  value = aws_lambda_function.post_authentication.arn
}

# F2 — explicit-close endpoint
output "end_session_invoke_arn" {
  description = "Invoke ARN for end-session (POST /sessions/{sessionId}/end)"
  value       = aws_lambda_function.end_session.invoke_arn
}

output "end_session_function_name" {
  value = aws_lambda_function.end_session.function_name
}

# F2 — sweep cron
output "expire_stale_sessions_arn" {
  description = "ARN for expire-stale-sessions (used by EventBridge target)"
  value       = aws_lambda_function.expire_stale_sessions.arn
}

output "expire_stale_sessions_function_name" {
  value = aws_lambda_function.expire_stale_sessions.function_name
}

# Phase 2 telemetry — vital coverage rollup
output "vital_coverage_rollup_arn" {
  description = "ARN for vital-coverage-rollup (EventBridge target for hourly Phase 2 telemetry rollup)"
  value       = aws_lambda_function.vital_coverage_rollup.arn
}

output "vital_coverage_rollup_function_name" {
  value = aws_lambda_function.vital_coverage_rollup.function_name
}

# Stream A5 — three more Phase 2 telemetry rollups (§4.7).
output "conversation_session_rollup_arn" {
  value = aws_lambda_function.conversation_session_rollup.arn
}
output "conversation_session_rollup_function_name" {
  value = aws_lambda_function.conversation_session_rollup.function_name
}
output "alert_flow_rollup_arn" {
  value = aws_lambda_function.alert_flow_rollup.arn
}
output "alert_flow_rollup_function_name" {
  value = aws_lambda_function.alert_flow_rollup.function_name
}
output "patient_engagement_rollup_arn" {
  value = aws_lambda_function.patient_engagement_rollup.arn
}
output "patient_engagement_rollup_function_name" {
  value = aws_lambda_function.patient_engagement_rollup.function_name
}

# F23 — voice-extracted patient creation
output "create_patient_from_voice_arn" {
  description = "ARN for create-patient-from-voice (invoked by bedrock-router via SDK)"
  value       = aws_lambda_function.create_patient_from_voice.arn
}

output "create_patient_from_voice_function_name" {
  value = aws_lambda_function.create_patient_from_voice.function_name
}

output "create_patient_invoke_arn" {
  value = aws_lambda_function.create_patient.invoke_arn
}

output "get_patients_invoke_arn" {
  value = aws_lambda_function.get_patients.invoke_arn
}

output "get_patients_function_name" {
  value = aws_lambda_function.get_patients.function_name
}

output "accept_invite_invoke_arn" {
  value = aws_lambda_function.accept_invite.invoke_arn
}

output "invite_attendant_invoke_arn" {
  value = aws_lambda_function.invite_attendant.invoke_arn
}

output "invite_doctor_invoke_arn" {
  value = aws_lambda_function.invite_doctor.invoke_arn
}

output "sync_observation_invoke_arn" {
  value = aws_lambda_function.sync_observation.invoke_arn
}

output "bulk_sync_invoke_arn" {
  value = aws_lambda_function.bulk_sync.invoke_arn
}

output "presigned_url_invoke_arn" {
  value = aws_lambda_function.presigned_url.invoke_arn
}

output "care_team_invoke_arn" {
  value = aws_lambda_function.care_team.invoke_arn
}

output "consent_invoke_arn" {
  value = aws_lambda_function.consent.invoke_arn
}

output "patient_summary_invoke_arn" {
  value = aws_lambda_function.patient_summary.invoke_arn
}

output "get_observations_invoke_arn" {
  value = aws_lambda_function.get_observations.invoke_arn
}

output "fetch_session_config_invoke_arn" {
  value = aws_lambda_function.fetch_session_config.invoke_arn
}

output "store_interaction_invoke_arn" {
  value = aws_lambda_function.store_interaction.invoke_arn
}

output "construct_fhir_batch_invoke_arn" {
  value = aws_lambda_function.construct_fhir_batch.invoke_arn
}

output "evaluate_thresholds_batch_arn" {
  value = aws_lambda_function.evaluate_thresholds_batch.arn
}

output "evaluate_thresholds_batch_function_name" {
  value = aws_lambda_function.evaluate_thresholds_batch.function_name
}

output "check_daily_deadline_arn" {
  value = aws_lambda_function.check_daily_deadline.arn
}

output "check_daily_deadline_function_name" {
  value = aws_lambda_function.check_daily_deadline.function_name
}

output "check_missed_measurements_arn" {
  value = aws_lambda_function.check_missed_measurements.arn
}

output "check_missed_measurements_function_name" {
  value = aws_lambda_function.check_missed_measurements.function_name
}

output "manage_recommendations_invoke_arn" {
  value = aws_lambda_function.manage_recommendations.invoke_arn
}

output "manage_parameter_configs_invoke_arn" {
  value = aws_lambda_function.manage_parameter_configs.invoke_arn
}

output "manage_interactions_invoke_arn" {
  value = aws_lambda_function.manage_interactions.invoke_arn
}

output "manage_prompts_invoke_arn" {
  value = aws_lambda_function.manage_prompts.invoke_arn
}

output "construct_fhir_batch_function_name" {
  description = "Function name of construct-fhir-batch Lambda"
  value       = aws_lambda_function.construct_fhir_batch.function_name
}

output "notification_sender_arn" {
  value = aws_lambda_function.notification_sender.arn
}

output "notification_sender_function_name" {
  value = aws_lambda_function.notification_sender.function_name
}

output "alert_crud_invoke_arn" {
  value = aws_lambda_function.alert_crud.invoke_arn
}

# PRD §6.9 / Spec §4.6 — caregiver-facing Care Notes endpoints.
output "care_notes_invoke_arn" {
  value = aws_lambda_function.care_notes.invoke_arn
}

output "threshold_crud_invoke_arn" {
  value = aws_lambda_function.threshold_crud.invoke_arn
}

output "device_token_invoke_arn" {
  value = aws_lambda_function.device_token.invoke_arn
}

output "reminder_crud_invoke_arn" {
  value = aws_lambda_function.reminder_crud.invoke_arn
}

output "remove_team_member_invoke_arn" {
  value = aws_lambda_function.remove_team_member.invoke_arn
}

# F29 / CG-V2-16 — DPDP right-to-erasure
output "delete_patient_invoke_arn" {
  description = "Invoke ARN for delete-patient (DELETE /patients/{patientId})"
  value       = aws_lambda_function.delete_patient.invoke_arn
}

output "delete_patient_function_name" {
  value = aws_lambda_function.delete_patient.function_name
}

output "all_function_names" {
  description = "List of all Lambda function names for monitoring"
  value = [
    aws_lambda_function.post_confirmation.function_name,
    aws_lambda_function.create_patient.function_name,
    aws_lambda_function.accept_invite.function_name,
    aws_lambda_function.invite_attendant.function_name,
    aws_lambda_function.invite_doctor.function_name,
    aws_lambda_function.sync_observation.function_name,
    aws_lambda_function.bulk_sync.function_name,
    aws_lambda_function.presigned_url.function_name,
    aws_lambda_function.patient_summary.function_name,
    aws_lambda_function.get_observations.function_name,
    aws_lambda_function.care_team.function_name,
    aws_lambda_function.fetch_session_config.function_name,
    aws_lambda_function.store_interaction.function_name,
    aws_lambda_function.construct_fhir_batch.function_name,
    aws_lambda_function.evaluate_thresholds_batch.function_name,
    aws_lambda_function.check_daily_deadline.function_name,
    aws_lambda_function.check_missed_measurements.function_name,
    aws_lambda_function.manage_recommendations.function_name,
    aws_lambda_function.manage_parameter_configs.function_name,
    aws_lambda_function.manage_interactions.function_name,
    aws_lambda_function.manage_prompts.function_name,
    aws_lambda_function.process_pending_invites.function_name,
    aws_lambda_function.notification_sender.function_name,
    aws_lambda_function.alert_crud.function_name,
    aws_lambda_function.threshold_crud.function_name,
    aws_lambda_function.device_token.function_name,
    aws_lambda_function.reminder_crud.function_name,
    aws_lambda_function.remove_team_member.function_name,
    # v2 Bedrock-backed Lambdas
    aws_lambda_function.bedrock_router.function_name,
    aws_lambda_function.bedrock_vision.function_name,
    aws_lambda_function.cost_telemetry_rollup.function_name,
    aws_lambda_function.health_check.function_name,
    aws_lambda_function.photo_presign.function_name,
    # F2 — session lifecycle
    aws_lambda_function.end_session.function_name,
    aws_lambda_function.expire_stale_sessions.function_name,
    # Phase 2 telemetry rollups (§4.7)
    aws_lambda_function.vital_coverage_rollup.function_name,
    # F23 — voice patient onboarding
    aws_lambda_function.create_patient_from_voice.function_name,
    # F29 / CG-V2-16 — DPDP right-to-erasure (appended to preserve
    # the count-indexed alarm mapping for the lambdas above).
    aws_lambda_function.delete_patient.function_name,
    # Stream C — DPDP consent records GET/POST/DELETE /consent.
    # Appended after delete_patient so the count-indexed alarm mapping
    # for every lambda above remains stable (alarm[38]).
    aws_lambda_function.consent.function_name,
    # Stream A5 — Phase 2 telemetry rollups #2-4 (§4.7). Appended at
    # the end so alarm count-indexed mapping for the lambdas above
    # remains stable (alarms[39, 40, 41]).
    aws_lambda_function.conversation_session_rollup.function_name,
    aws_lambda_function.alert_flow_rollup.function_name,
    aws_lambda_function.patient_engagement_rollup.function_name,
    # Task #23 — SES bounce/complaint suppression handler. Appended
    # at the end so alarm count-indexed mapping for the lambdas above
    # remains stable (alarm[42]).
    aws_lambda_function.ses_suppression_handler.function_name,
    # 2026-05-15 staging soak — get-patients was CLI-deployed to dev
    # 2026-04-27 (never declared in terraform), so staging's apply
    # omitted it. Adding to terraform now; dev needs `terraform import`
    # to reconcile (memory: v2_open_blockers_endofday_20260515.md).
    aws_lambda_function.get_patients.function_name,
  ]
}

output "ses_configuration_set_name" {
  description = "Name of the SES configuration set that fan-outs Bounce/Complaint events to the suppression handler. Wire into the cognito module's email_configuration so Cognito's transactional sends also flow through bounce handling."
  value       = aws_sesv2_configuration_set.matika_default.configuration_set_name
}

output "ses_events_topic_arn" {
  description = "ARN of the SNS topic the SES configuration set publishes Bounce + Complaint events to. Cite in the AWS Support SES production-access ticket."
  value       = aws_sns_topic.ses_events.arn
}

# ============================================================
# V2 — Bedrock-backed Lambdas
# ============================================================

output "bedrock_router_invoke_arn" {
  description = "Invoke ARN for bedrock-router (used by API Gateway integrations)"
  value       = aws_lambda_function.bedrock_router.invoke_arn
}

output "bedrock_router_function_name" {
  value = aws_lambda_function.bedrock_router.function_name
}

output "bedrock_vision_invoke_arn" {
  description = "Invoke ARN for bedrock-vision (used by API Gateway integration)"
  value       = aws_lambda_function.bedrock_vision.invoke_arn
}

output "bedrock_vision_function_name" {
  value = aws_lambda_function.bedrock_vision.function_name
}

output "cost_telemetry_rollup_arn" {
  description = "ARN for cost-telemetry-rollup (used by EventBridge target)"
  value       = aws_lambda_function.cost_telemetry_rollup.arn
}

output "cost_telemetry_rollup_function_name" {
  value = aws_lambda_function.cost_telemetry_rollup.function_name
}

output "health_check_invoke_arn" {
  description = "Invoke ARN for health-check (used by API Gateway integration)"
  value       = aws_lambda_function.health_check.invoke_arn
}

output "health_check_function_name" {
  value = aws_lambda_function.health_check.function_name
}

output "photo_presign_invoke_arn" {
  description = "Invoke ARN for photo-presign (used by API Gateway integration)"
  value       = aws_lambda_function.photo_presign.invoke_arn
}

output "photo_presign_function_name" {
  value = aws_lambda_function.photo_presign.function_name
}

# F47 — Cognito nightly snapshot lambda (consumed by module.eventbridge
# for the daily trigger and by module.monitoring for the missing-snapshot
# alarm).
output "cognito_snapshot_arn" {
  description = "ARN for cognito-snapshot lambda (EventBridge target for F47 nightly snapshot)"
  value       = aws_lambda_function.cognito_snapshot.arn
}

output "cognito_snapshot_function_name" {
  value = aws_lambda_function.cognito_snapshot.function_name
}
