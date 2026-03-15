# CareLog Bastion Module - Outputs

output "instance_id" {
  description = "ID of the bastion EC2 instance"
  value       = aws_instance.bastion.id
}

output "security_group_id" {
  description = "ID of the bastion security group"
  value       = aws_security_group.bastion.id
}

output "ssm_port_forward_command" {
  description = "AWS CLI command to port-forward RDS via the bastion"
  value       = "aws ssm start-session --target ${aws_instance.bastion.id} --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{\"host\":[\"RDS_ENDPOINT\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5432\"]}' --region ${data.aws_region.current.name}"
}
