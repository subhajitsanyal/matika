# Matika v2 — prod Terraform tree TODO (DEFERRED)

**Status as of 2026-05-03:** Deferred. Plan is to run limited trials against dev first, then revisit prod stand-up afterwards.

The prod environment is **scaffolded in source but not applied** — `infrastructure/terraform/environments/prod/main.tf` and `variables.tf` exist with production-grade settings (Multi-AZ RDS, 3 AZs, HealthLake on, deletion protection, backup retention 35 days). The S3 backend is configured with `key = "prod/terraform.tfstate"` and the backing bucket + lock table already exist (provisioned during dev cycle).

When ready to resume, see commit `906260e` for the scaffold and the rest of this doc for the apply procedure.

## Resuming from the scaffold

1. **Set tfvars in `environments/prod/terraform.tfvars`** (gitignored):

   ```hcl
   ses_email_arn  = "arn:aws:ses:ap-south-1:<account-id>:identity/<verified-prod-sender>"
   ses_from_email = "Matika <noreply@<your-prod-domain>>"
   alert_email    = "<ops-alias@your-domain>"   # NOT a personal inbox
   ```

   Skipping any of these: Cognito falls back to its 50/day built-in mail (fine for limited testing, not for scale); empty `alert_email` skips the entire monitoring module.

2. **Verify the plan still holds:**

   ```bash
   cd infrastructure/terraform/environments/prod
   terraform init    # safe to re-run; idempotent
   terraform plan    # should show ~370 resources to create
   ```

   If anything has drifted in the modules since 2026-05-03, the plan output will surface it. Read the diff before applying.

3. **Apply** — provisions ~370 resources, takes 10–15 min:

   ```bash
   terraform apply
   ```

4. **Run V001-V005 Flyway migrations** against the new RDS via the SSM bastion port-forward (same pattern as dev):

   ```bash
   aws ssm start-session --target $(terraform output -raw bastion_instance_id) \
     --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters '{"host":["<prod-rds>"],"portNumber":["5432"],"localPortNumber":["5432"]}' \
     --region ap-south-1
   cd backend/database && flyway migrate
   ```

5. **Confirm the SNS subscription email** AWS sends to the `alert_email` value before relying on alarm delivery.

6. **Consider bumping `bedrock_router_provisioned_concurrency`** in `prod/main.tf` once the Lambda concurrent-executions quota increase has landed (request id `b654fb014ff241d9b211ab0dee3e371cvCB0VBF4`). Default is 0; bump to 5+ for prod once the quota allows.

## Cost expectation when resumed

Idle floor at the configured prod sizing:
- RDS `db.r6g.large` Multi-AZ in ap-south-1: ~$280–320/month
- 3 NAT gateways (one per AZ): ~$95/month
- KMS keys: ~$10/month
- HealthLake: ~$5–50/month at low volume
- Lambdas, Cognito, S3 idle: nominal
- CloudWatch logs: small fixed + per-byte ingestion

**Rough idle floor: ~$400–500/month** before any pilot traffic.

## Notes from the dev-for-trials phase

While running limited trials on dev, watch for issues that should change the prod scaffold before applying:

- **Bedrock model availability under load** — if dev surfaces sporadic Marketplace-subscription denials at scale, document the IAM and model-access pattern that worked.
- **RDS sizing** — dev runs on `db.t3.micro`, which is genuinely tiny. Trial traffic should stress more than the dev hardware. If you see CPU/IOPS hot at low load, prod's `db.r6g.large` may be undersized too (one tier larger if so).
- **CloudWatch alarm thresholds** — current values (router p99 > 15s, vision p99 > 18s) were guessed pre-traffic. If trials show those firing on healthy operation, retune *before* prod applies them.
- **Caregiver flow Sonnet reliability** — known to occasionally drop `<output>` envelopes. Trial volume will surface how rare that really is.
- **DPDP review of `global.*` Bedrock inference profiles** — get the legal answer before prod, not after. If the answer is "in-region only," prod's bedrock_*_model_id needs to switch to `apac.*` profiles, which currently lag the latest model versions.

---

*Generated 2026-05-03. Prod work paused at commit `906260e`; resume from this doc.*
