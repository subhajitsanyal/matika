output "post_confirmation_arn" {
  value = aws_lambda_function.post_confirmation.arn
}

output "create_patient_invoke_arn" {
  value = aws_lambda_function.create_patient.invoke_arn
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
  ]
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
