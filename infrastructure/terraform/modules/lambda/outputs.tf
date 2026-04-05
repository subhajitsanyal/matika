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

output "patient_summary_invoke_arn" {
  value = aws_lambda_function.patient_summary.invoke_arn
}

output "get_observations_invoke_arn" {
  value = aws_lambda_function.get_observations.invoke_arn
}
