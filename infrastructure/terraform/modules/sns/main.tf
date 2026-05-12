# SNS Push Notification Infrastructure
# Configures SNS platform applications for iOS (APNs) and Android (FCM HTTP v1).
#
# Scope note: this module deliberately ships ONLY the platform
# applications. The original module also bundled SNS topics
# (endpoint_events, delivery_failures, threshold_alerts, reminder_alerts),
# a CloudWatch log group + IAM role for delivery-status logging, and
# the platform apps' event_*_topic_arn wiring. None of that is
# subscribed-to anywhere in the codebase today, so it's dead
# infrastructure. The platform apps work without those topics — SNS
# just doesn't fire endpoint-lifecycle / delivery-failure events on
# top of them. When a real subscriber lands (e.g. a delivery-failure
# Lambda for retry queueing), re-add the relevant topic + wire the
# `event_*_topic_arn` arg on the platform application.

# iOS APNs Platform Application
#
# Gated behind `count` because iOS is parked for v2.0 (Android-only beta;
# see docs/v2_launch_plan.md §1). When iOS unparks in v2.1, populate the
# APNs cert + private key in env-scoped tfvars and the resource will be
# created.
resource "aws_sns_platform_application" "ios_apns" {
  count = var.apns_certificate != "" && var.apns_private_key != "" ? 1 : 0

  name                = "${var.project_name}-ios-apns-${var.environment}"
  platform            = var.environment == "prod" ? "APNS" : "APNS_SANDBOX"
  platform_credential = var.apns_private_key
  platform_principal  = var.apns_certificate

  # NB: aws_sns_platform_application does not accept a `tags` argument
  # (provider limitation as of AWS provider v5.100). SNS Platform Apps
  # are untagged.
}

# Android FCM Platform Application — FCM HTTP v1 (token-based auth).
#
# `platform_credential` is the entire FCM HTTP v1 service-account JSON
# blob (downloaded from Firebase console: Project settings → Service
# accounts → Generate new private key). AWS auto-detects the
# token-based vs legacy server-key format from the credential string.
#
# `lifecycle.ignore_changes` on `platform_credential`: AWS does not
# return the credential via `GetPlatformApplicationAttributes` (only
# `Enabled` + `AuthenticationMethod`). Without `ignore_changes`,
# terraform sees state.platform_credential as null after import and
# tries to "update" it every plan, even though the live value matches.
# Rotating the credential becomes a manual `terraform state rm` +
# re-import, which is acceptable given the rare cadence (FCM service
# account rotations are infrequent and operationally tracked separately
# in the SNS+FCM provisioning runbook, setup-and-deployment-guide.md
# §6.6).
resource "aws_sns_platform_application" "android_fcm" {
  name                = "${var.project_name}-android-fcm-${var.environment}"
  platform            = "GCM"
  platform_credential = var.fcm_server_key

  lifecycle {
    ignore_changes = [platform_credential]
  }
}
