# Matika v2 — prod Terraform tree TODO

The dev environment under `infrastructure/terraform/environments/dev/` is fully provisioned and running. There is **no `prod/` equivalent yet** — the path to a real production deploy is undefined. This doc tracks what to build.

## Plan

1. **Copy the env scaffold:**
   ```
   cp -R infrastructure/terraform/environments/dev infrastructure/terraform/environments/prod
   ```
   Then strip the local state files (`terraform.tfstate*`) and the cached `.terraform/` if any — prod gets a fresh state.

2. **Edit `environments/prod/main.tf`:**
   - Backend block: same bucket (`carelog-terraform-state`), but `key = "prod/terraform.tfstate"` instead of `dev/`.
   - VPC sizing: `vpc_cidr = "10.1.0.0/16"` (don't collide with dev's `10.0.0.0/16`).
   - AZs: 3 instead of 2 — `["ap-south-1a", "ap-south-1b", "ap-south-1c"]` plus matching `public_subnet_cidrs` and `private_subnet_cidrs`.
   - Database: `db_instance_class = "db.r6g.large"` (Multi-AZ), `db_allocated_storage` bumped, automated backups enabled.
   - S3 bucket prefix: `carelog-v2-prod` (or whatever — must be unique).
   - Feature flags: `enable_healthlake = true`, `enable_bastion = true` (still useful for prod debugging via SSM).
   - bedrock-router provisioned concurrency: bump from 0 to N once the Lambda concurrency quota increase lands (currently filed at request ID `b654fb014ff241d9b211ab0dee3e371cvCB0VBF4`).

3. **Edit `environments/prod/variables.tf`:** mirror dev (no shape changes), just default values where prod needs them.

4. **Edit `environments/prod/terraform.tfvars`** (gitignored):
   - `alert_email` — operations alias, NOT a personal inbox. Sometime like `oncall@matika.health` or whatever the real op address is.
   - `ses_email_arn` — production verified SES identity (separate from the dev one).
   - `ses_from_email` — production sender format.

5. **Bootstrap state:** the S3 bucket + DynamoDB lock table already exist (created during dev cycle from `infrastructure/terraform/bootstrap/`). No need to re-bootstrap.

6. **First apply:**
   ```
   cd infrastructure/terraform/environments/prod
   terraform init    # initializes the S3 backend with prod/ key
   terraform plan    # should show ~all-create (fresh env)
   terraform apply
   ```
   Expect 200+ resource creates. Watch for ordering issues (Cognito post-confirmation trigger needs Lambdas to exist first; usually resolves in a single apply).

7. **Pre-prod migrations:** V001-V005 Flyway migrations need to run against the new RDS. Same SSM port-forward path as dev:
   ```
   aws ssm start-session --target <prod-bastion> \
     --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters '{"host":["<prod-rds>"],"portNumber":["5432"],"localPortNumber":["5432"]}' \
     --region ap-south-1
   cd backend/database && flyway migrate
   ```

8. **Bedrock model subscriptions:** the prod account may need to re-subscribe to Anthropic Marketplace listings (Haiku 4.5, Sonnet 4.6) on first use. If the dev account and prod account are the same AWS account, no action needed. If different accounts, expect "AWS Marketplace actions" denials on first invoke and follow the same pattern as dev (Marketplace IAM is already attached to bedrock-router's role; just trigger first invoke as the role).

9. **Lambda quota:** the concurrent-execution quota is per-account-per-region. If prod is in a separate account, file a separate quota increase request before pilot.

10. **CloudWatch alarms:** `alert_email` set in step 4 will activate the same 45 alarms that dev has. Confirm the SNS subscription email when AWS sends it.

11. **Smoke-test:** repeat the `/conversation/turn` end-to-end smoke against the prod API Gateway URL with a real prod-Cognito test user.

## Pre-flight questions before starting

- **Same AWS account as dev, or separate?** Affects Marketplace subscription, quota, and naming uniqueness.
- **Same region (ap-south-1) only, or also ap-southeast-1 / us-east-1 for cross-region inference fallback?** Today the dev `INFERENCE_PROFILE_REGION` is `ap-south-1` and we route via `global.*` profiles. If DPDP review (legal) requires in-region only, prod will also need to switch to `apac.*` profiles.
- **Multi-AZ RDS or single-AZ?** Multi-AZ doubles cost but is the right call for prod. Spec assumes Multi-AZ.

---

*Generated 2026-05-03 — final outstanding backend-tree task before pilot.*
