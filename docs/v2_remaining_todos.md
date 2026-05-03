# Matika v2 — Remaining TODOs (post-2026-05-03 backend-complete checkpoint)

**Status as of 2026-05-03:** Backend pipeline (text + streaming + photo + vision + caregiver onboarding + protocol persistence) is live in dev. CloudWatch alarms are provisioned and pointed at `subhajit@kyabla.in` (pending SNS confirmation). State is in S3 with locking. DB credentials fetch at runtime. 364 unit tests passing across the v2 Lambdas.

This doc tracks what's still open between here and pilot launch. The **planning docs `docs/matika_implementation_plan_v2.md` and `docs/v2_status_pre_pilot.md` are stale** as of this date — many T-V2-XXX items they flag as not-started were completed during the 2026-05-02/03 session. This file is the current source of truth.

Recent commits worth scanning if you're picking this up:

```
da9cfd2  Wire alert_email through dev environment to activate alarms
a5ac85d  Add v2 CloudWatch alarms (latency, throttles, /health 5xx)
37338a7  Fix caregiver onboarding parse failures (Guardrail false positives)
1d7dd46  T-V2-303: caregiver attribution via actorCognitoSub
fe58f2b  Add TurnRequest.sessionType for caregiver session entry
91e00ca  T-V2-302: persist caregiver protocol on session complete
b9d678e  Fix bedrock-vision FK + add Sonnet to its IAM
0a56358  Wire /conversation/turn-stream to handleTurnStream
871ee42  Add photo-presign Lambda + /conversation/photo-presign route
84070c2  (later reverted) Remove Marketplace IAM
5a2984e  Move PG credentials from Lambda env vars to runtime SecretsManager fetch
8ad8e43  Migrate dev Terraform state to S3 backend
4847a34  Wire real RDS, Bedrock, and S3 probes into /health
b5ea562  Pin bastion AMI to standard AL2023 (not minimal)
a1b43a5  Add confirmation/correction examples to system_v2 prompt
1a09af3  End-to-end smoke test passing
```

---

## HIGH — pilot blockers

### 1. Android v2 client migration
**Scope:** detailed breakdown lives in this session's history; summary —

| Component | New | Notes |
|---|---|---|
| On-device STT (`SpeechRecognizer`) | new `OnDeviceSttManager.kt` | Risk: Indian-language coverage varies by OEM; need keyboard fallback at app start probe |
| On-device TTS (`TextToSpeech`) | new `OnDeviceTtsManager.kt` | Risk: missing Hindi/Bengali voices on stock images; offer Google TTS install prompt |
| `/conversation/turn` HTTP client | extend `CloudApiService` + new DTOs | Schema must mirror `output_schema.json` exactly |
| Repo rewrite | `ConversationRepository.kt`, `SessionManager.kt` | Server holds session state in v2 — client just sends `sessionId`+`turnSequence` |
| `/conversation/turn-stream` SSE | new `SseEventSource.kt` (OkHttp custom) | Optional for v2.0; defer to v2.0.1 if needed |
| Photo flow | new `PhotoUploadManager.kt` | Backend ready — `/conversation/photo-presign` returns URL + `requiredHeaders` (must echo `x-amz-server-side-encryption: aws:kms`) |
| Health banner repointing | `ModelStatusBanner.kt` | Hits AWS `/health`; gate "Start Conversation" on healthy + on-device STT availability |
| Delete v1 Mac Mini code | 6 files in `network/` + `discovery/` | `MacMiniLlmApi`, `MacMiniSttApi`, `MacMiniTtsApi`, `MacMiniVisionApi`, `MacMiniDiscovery`, `MacMiniUrlProvider` |
| Onboarding flows | edit caregiver/patient onboarding ViewModels | Pass `sessionType: 'caregiver_onboarding'` and `actorCognitoSub` on turn 1 |

**Open questions for the engineer:**
- Target device list for the pilot? STT/TTS quality is OEM-dependent.
- Streaming as v2.0 hard requirement or acceptable to defer?

**~3-4 weeks of focused engineering for one engineer; ~2 weeks parallelized for two.**

### 2. iOS v2 client migration
Same shape as Android; separate engineer. Defer until Android stabilizes so iOS can template.

### 3. Lambda concurrency quota increase
- **Filed:** request id `b654fb014ff241d9b211ab0dee3e371cvCB0VBF4` (10 → 1000) via Service Quotas API
- **Check status:** `aws service-quotas get-requested-service-quota-change --request-id b654fb014ff241d9b211ab0dee3e371cvCB0VBF4 --region ap-south-1`
- **If denied / pending review:** justification text already drafted in earlier session messages. Open an explicit support case with the Matika pilot rationale.

### 4. SNS subscription confirmation
**Action needed from you:** click the "Confirm subscription" link in the AWS notification email sent to `subhajit@kyabla.in`. Until then, alarms transition between OK/ALARM but no emails fire. Subject: *"AWS Notification - Subscription Confirmation"*.

### 5. AWS BAA cross-region inference coverage
The current routing uses `global.*` inference profiles (Haiku 4.5 + Sonnet 4.6), which means traffic can land in any AWS region. Need to confirm with AWS healthcare/BAA team that this is covered for HIPAA/DPDP. Owner: legal/contracts, not engineering.

If the answer is **no, must stay in-region (apac.\*)**, the fallback model is:
- Sonnet: `apac.anthropic.claude-sonnet-4-20250514-v1:0` (older Sonnet 4 build, no 4.6)
- Haiku: 4.5 isn't available on apac yet — would have to use Haiku 3.5 or wait

### 6. DPDP (India compliance) review of global.* routing
Same question through the India compliance lens. Cross-region traffic from ap-south-1 may or may not be acceptable under DPDP Act. Owner: legal.

### 7. prod Terraform tree
`infrastructure/terraform/environments/prod/` doesn't exist. Plan:

1. Copy `environments/dev/` → `environments/prod/`
2. Edit:
   - `vpc_cidr` (different from dev — pick `10.1.0.0/16`)
   - `availability_zones` (3 AZs not 2)
   - `db_instance_class` (`db.r6g.large` instead of `db.t3.micro`)
   - `enable_healthlake = true`
   - Bedrock provisioned-concurrency on bedrock-router (after quota increase)
   - Different S3 bucket prefix
   - Backend block: `key = "prod/terraform.tfstate"` (same bucket as dev)
3. New `terraform.tfvars`:
   - `alert_email` → operations alias, not a personal inbox
   - `ses_email_arn` → real production sender
4. Run bootstrap: state bucket + lock table already exist (created in dev cycle).
5. `terraform init && terraform apply` — fresh state file; AWS resources all new.

Pre-prod: V001-V005 Flyway migrations need to run against the new RDS. Same SSM port-forward path.

### 8. Caregiver session client flow
The backend now accepts `sessionType: 'caregiver_onboarding'` and `actorCognitoSub` on `/conversation/turn`. Smoke-tested via direct Lambda invoke (commit `1d7dd46`'s smoke run produced a complete protocol persistence flow). What's missing is **a client UI flow** that actually constructs and sends those requests. Lives inside the Android/iOS scope.

---

## MEDIUM — pre-pilot recommended

### 9. Caregiver prompt tuning v2
After the Guardrail bypass + system prompt updates landed, Sonnet still occasionally:
- Asks excessive clarification questions before firing `complete_session` (test data artifact: real caregiver/patient pairs need to be distinct in the test fixtures)
- Drops `<output>` on truly long, multi-paragraph responses (rare, hard to repro)

Mitigations to consider:
- Add 2-3 more worked examples to `prompts/system_v2_caregiver_onboarding.md` for less-common patterns
- Tighten the parser to accept bare JSON when `<output>` tags are missing as a *fallback* (with telemetry counter) — currently rejected because we want to see the drift
- Build proper test fixtures (distinct cognito users for patient + caregiver) so smoke runs aren't subject to identity-mismatch noise

### 10. Streaming endpoint — true wire-level
**Current state:** `/conversation/turn-stream` is wired to `handleTurnStream`, emits valid SSE events, but **API Gateway REST buffers the full response.** Wire format is correct; clients parse incrementally from the buffered body. No per-token win on time-to-first-audio.

**Path to real streaming:** move the route to either Lambda Function URL with response streaming, or migrate to API Gateway HTTP API v2 (which supports streaming integrations). Both are non-trivial: Function URL means no Cognito authorizer (need a Lambda authorizer), HTTP API needs a different module + integration shape. Tracked as a v2.1 task.

### 11. Admin telemetry tabs (web portal)
`cost_telemetry` and `model_call` have real data flowing in. Spec §9.1 calls for three tabs in the doctor/admin portal:
- **Cost & Telemetry** — daily cost rollup, per-tier breakdown, per-patient
- **Escalations** — counts of `escalation_reason='emergency'`, `caregiver_protocol_design`, `summarizer_overflow`, etc.
- **Latency** — p50/p95/p99 over time, sliced by tier and inference region

Read-only views — no new state. Lives in `web-portal/src/pages/admin/` (doesn't exist yet).

### 12. Doc refresh
`v2_status_pre_pilot.md` and `matika_implementation_plan_v2.md` are stale (many T-V2-XXX items marked "not started" were completed in this session). Tasks:
- Mark T-V2-002 (Bedrock model access), T-V2-005 (RPM quota), V005 migration, T-V2-022 (health-check), T-V2-023 (DevOps/IAM), T-V2-046 (PG runtime fetch), T-V2-302 (caregiver protocol), T-V2-303 (caregiver attribution) as **done**.
- Note that `prod/` env, Android client, and iOS client are still open.
- Cross-link this `v2_remaining_todos.md` from both planning docs as the current source of truth.

### 13. Confirmed-value → FHIR observations integration
Today's `/conversation/turn` records confirmed extracted values in `interaction_sessions.transcript_history` and `model_call`, but they don't yet flow into the v1 `observations` (FHIR) path. Need to verify (and likely build) the bridge: when a value transitions to `status: 'confirmed'`, an FHIR Observation gets written to S3 + RDS.

There's a v1 `sync-observation` Lambda — check whether it's the right hook, or whether bedrock-router should write directly.

### 14. Marketplace IAM scope tightening
Currently `Resource = "*"` on `aws-marketplace:Subscribe` for the bedrock-router role. AWS doesn't document narrower ARNs for Marketplace ops, so this stays permissive. Re-investigate periodically; document it as a known accepted risk for v2.0.

---

## LOW — post-pilot

### 15. CloudWatch alarm tuning
Pre-pilot thresholds are conservative estimates:
- bedrock-router p99 > 15s → 2 periods × 5 min
- bedrock-vision p99 > 18s → 2 periods × 5 min
- Throttles > 0 → 1 period × 1 min
- Lambda error rate > 5% → 1 period × 5 min

Re-tune after 2 weeks of real pilot data. Add p99 alarms on `summarizer` and `photo-presign` if their volumes warrant.

### 16. Per-region inference cost dashboard
`cost_telemetry` rollup runs daily via EventBridge. Building a simple Grafana / CloudWatch dashboard scoped to the table will help operational visibility once the admin web tabs (item 11) ship.

### 17. Local-dev DATABASE_URL fallback
`db_secret.ts` requires `DB_SECRET_ARN` and fetches via Secrets Manager — works in deployed Lambdas, doesn't work for someone running the handler locally with a port-forwarded RDS. Adding a `DATABASE_URL`-or-`PG*` fallback for local-only dev would smooth the inner loop.

### 18. Test data fixtures for caregiver/patient pairs
Smoke testing the caregiver flow today requires manually seeding `interaction_sessions` rows or using the test patient's own cognito sub as the "actor" (which makes the model justifiably confused). Real fixtures:
- One Cognito user per role: patient, caregiver, attendant, doctor
- `persona_links` rows wiring caregiver→patient
- Matching `users` + `patients` rows

Lives in a future `test-automation/seed/` script.

### 19. Bastion AMI/SSM hardening
Already pinned to standard AL2023 (not minimal) and userdata explicitly installs `amazon-ssm-agent`. No regression expected, but worth re-verifying after AWS pushes major AL2023 image updates.

---

## Operational / activation checklist

- [ ] Click SNS subscription confirmation in `subhajit@kyabla.in` inbox
- [ ] Run `aws service-quotas get-requested-service-quota-change --request-id b654fb014ff241d9b211ab0dee3e371cvCB0VBF4 --region ap-south-1` and report status. If APPROVED, no further action. If DENIED, file an explicit AWS support case using the Matika pilot rationale.
- [ ] Submit BAA scope question to AWS healthcare team (item 5)
- [ ] Submit DPDP question to legal (item 6)
- [ ] Decide on streaming (item 10) for v2.0 vs v2.0.1
- [ ] Decide on Android device coverage list (item 1) before client engineer starts

---

## Known caveats / accepted risks for v2.0

- `parameter_configs.threshold_set_by` is null when client doesn't send `actorCognitoSub` (fail-tolerant path; T-V2-303 closed the path but it's optional)
- `aws-marketplace:Subscribe` is on `Resource = "*"` for bedrock-router (item 14)
- `/conversation/turn-stream` is buffered, not wire-streamed (item 10)
- Caregiver sessions skip the Bedrock Guardrail (commit `37338a7` — caregiver_onboarding had legitimate medication-mention false positives that broke the flow; system prompt forbids prescriptive output independently)
- pre-pilot Sonnet drops `<output>` tags on rare long-response turns; one diagnostic log captures the snippet so future regressions are debuggable
- State backend is S3 + DynamoDB lock; bootstrap is in `infrastructure/terraform/bootstrap/` and uses local state on purpose

---

*Generated 2026-05-03 by claude-opus-4-7 during the v2 backend-complete checkpoint session.*
