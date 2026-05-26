# Care Notes — progress & next-step handoff

**Snapshot date:** 2026-05-25 evening (IST 2026-05-26 ~03:35 UTC)
**Authoritative plan:** `docs/care-notes-execution-plan.md`
**Status TL;DR:** Phases 1–4 complete and live-verified on dev + staging. Phases 5–7 remain. Feature is production-equivalent across both envs; what's left is hardening (disambiguation fixtures), bench coverage (Maestro flow set), and docs.

---

## 1. What "works right now"

### Phase 1 — DB migration
- `V016__care_notes.sql` applied to dev RDS (Flyway history drifted; applied via `flyway repair` + `-ignoreMigrationPatterns="*:ignored"` — see [[dev_flyway_history_drift_20260525]]).
- Same migration applied to staging RDS via SSM tunnel (bastion `i-0f2acdf1a96ee24a6`, port 55433).
- 3 partial indexes present on both envs (`idx_care_notes_patient_unacked`, `idx_care_notes_recipient_unacked`, `idx_care_notes_session`).
- ENUMs: `care_note_source`, `care_note_recipient_role`, `care_note_disambiguation_status`.
- `update_care_notes_updated_at` trigger fires on UPDATE.

### Phase 2 — care-notes lambda + API routes
- **Dev:** `matika-dev-care-notes` live; routes `GET /patients/{patientId}/care-notes`, `POST /patients/{patientId}/care-notes/{noteId}/acknowledge`, `GET /caregivers/{caregiverUserId}/care-notes/unread-count` all return clean 401 from Cognito authorizer.
- **Staging:** Same three routes also live (deployed 2026-05-25 evening via Terraform `-target` with `aws_api_gateway_stage.main` included — see [[apigw_stage_deployment_targeting]]). Lambda sha `eIBuNx+WYs393ecp0G6jKVVDHkvaxk8qboWo7AX8Yrk=`, 2.6 MB.
- **Tests:** 17/17 jest tests pass for the lambda (`backend/lambdas/care-notes/__tests__/index.test.js`).

### Phase 3 — bedrock-router record_note write path
- `matika-{dev,staging}-bedrock-router` carry Phase 3 code (sha `pLYPDtc0RA+mjBrCcWtrKfl+DysNN+YDa/1vpgsoesA=`).
- Tests: 31 new (16 `care_notes_recorder.test.ts` + 13 `handler_care_notes.test.ts` + 3 `per_patient.test.ts` extensions + db.test count adjustment). Total: 428/428 pass.
- Live verified end-to-end on dev: synthetic invoke (session `ccec8418-bef5-4c57-87a4-a5c449fd1a34`) produced `record_note` action → care_notes row `cc67321d-723f-4d7d-b607-2ab7093de658` in dev RDS, `disambiguation_status='resolved'`, recipient John CG.
- Live verified on staging: synthetic invoke (sessions `0b1b62f9-…` and `23a42d77-…`) produced rows `a28ef4b8-cfa0-4c51-8095-293f297dfee4` and `b94861b9-a975-4df7-b8a5-15018467a6b1` in staging RDS, both resolved to John CG.

### Phase 4 — Android caregiver UI
- Built debug APK + installed on Samsung S21+ (RFCT10C1GSZ).
- Maestro flow `.maestro/flows/cg_v2_25_caregiver_care_notes.yaml` exercises the full path: login → tap Jane PT → tap Notes → see row in Unacked tab → tap Acknowledge → row moves to Resolved tab. All 10 steps pass.
- Live RDS verification post-flow: `b94861b9-…` acked at `2026-05-26T03:34:10Z` by `f375ce5e-3d1b-4f6b-9c4f-e1fc1484f411` (John CG). `unacknowledgedCount` went from 1 → 0.

---

## 2. Test data on staging (handy for re-runs)

| Identifier | Value |
|---|---|
| Jane PT patient_id (RDS UUID) | `d4d38abb-af57-4658-a9e4-32b8701d12da` |
| Jane PT cognito_sub | `3153ddaa-1021-7029-8c6b-b3d4884e1072` |
| John CG user_id (RDS UUID) | `f375ce5e-3d1b-4f6b-9c4f-e1fc1484f411` |
| John CG cognito_sub | `21c36d3a-b0f1-7030-d066-7950326a70d2` |
| Currently acked care_notes rows | `a28ef4b8-…` (T03:25:46Z), `b94861b9-…` (T03:34:10Z) |
| Currently unacked care_notes rows | none |

To re-seed an unacked row on staging:
```bash
SESSION_ID=$(uuidgen | tr 'A-Z' 'a-z')
cat > /tmp/seed.json <<EOF
{
  "sessionId": "$SESSION_ID",
  "patientId": "3153ddaa-1021-7029-8c6b-b3d4884e1072",
  "transcript": "Can you please ask my caregiver to add cholesterol to my daily tracking?",
  "language": "en-IN",
  "turnSequence": 1
}
EOF
aws lambda invoke --function-name matika-staging-bedrock-router \
  --payload fileb:///tmp/seed.json --cli-binary-format raw-in-base64-out \
  --region ap-south-1 /tmp/out.json
```
The bedrock-router will call Bedrock, the LLM will emit `record_note`, and the handler will INSERT a resolved care_notes row. Cost: ~6k input tokens, ~200 output. Subsequent invocations get cache hits (~1500 input tokens).

Dev equivalents (Jane Doe + John CG on dev) are in [[jane_dev_test_account]].

---

## 3. Open TODOs — what's next

### Phase 5 — Disambiguation + test fixtures (NEXT)
Plan §4 Phase 5 details. Required work:
1. **Add a second caregiver to Jane's care team** named "John Smith" so the ambiguous-resolution path (LLM sees two `John`s → emits raw `mentionedName: "John"` → handler returns `disambiguation_status='ambiguous'`) can be exercised end-to-end.
   - Cognito user: `sanyalsubhajit2010+cg2@gmail.com` (create manually via Cognito console OR stub `users.cognito_sub` with a dev-only synthetic value if no login flow needed).
   - SQL seed to be checked in at `backend/database/test_fixtures/care_notes_disambiguation_seed.sql`. Run on dev + staging via SSM tunnel.
2. **Unit test for the handler's sentinel-update path against a live two-turn invocation.** Tests already cover the resolver decision logic and the in-process flow (`handler_care_notes.test.ts > sentinel update on disambiguating turn`); need a synthetic 2-turn live invoke that proves the ambiguous row is UPDATEd (not duplicated) when the patient names one of the candidates on the next turn.
3. **Live verify ambiguous → resolved RDS state transition** on dev (and staging once the seed is in place).

### Phase 6 — Maestro journeys + bench evidence
Plan §4 Phase 6. Required work:
1. Already have `cg_v2_25_caregiver_care_notes.yaml`. Per the plan that's actually CG-V2-25 (ack flow), and the plan also calls for CG-V2-24 (browse-only) and LV-V2-19 (voice disambiguation). Author the missing two:
   - `cg_v2_24_care_notes_browse.yaml` — caregiver opens Notes screen and asserts the cholesterol row + unread-count badge, NO ack. Browse-only smoke.
   - `lv_v2_19_care_note_disambiguate_voice.yaml` — patient voice flow that says "tell John to refill my prescription" — asserts the LLM follow-up question fires on turn 2 — patient says "John CG" — asserts `care_notes` row at session end has `disambiguation_status='resolved'` + `recipient_user_id` = John CG. Depends on Phase 5 fixture (second John in care team).
2. **Re-seed pattern for repeatable runs.** The cg_v2_25 flow as authored is single-shot — acks the only unacked row, then can't re-run cleanly. Consider extracting `scripts/seed-care-note.sh` so a wrapper can `seed && maestro-run.sh && cleanup` per run. See [[maestro_seed_before_idempotent_ack]].
3. **Bench evidence rows.** Per [[feedback_verify_live_pattern]]: each PASS row in `docs/journeys_non_voice.md` and `docs/voice_multi_turn_journeys.md` must include session UUID + CloudWatch RequestId + RDS row dump. The dev + staging session UUIDs from §1 above are the evidence; copy them into the writeups.

### Phase 7 — Docs + memory
Plan §4 Phase 7. Required work:
1. `docs/journeys_non_voice.md` — add CG-V2-24 + CG-V2-25 rows with bench evidence (status, session UUID, RDS row id, CloudWatch RequestId).
2. `docs/voice_multi_turn_journeys.md` — add LV-V2-19 row.
3. `docs/testing_todos_v2.md` — close the F59 "Open question" about cholesterol-request capture (this feature is the closure). Note agent-originated observations (`source='matika_observation'`) deferred to v2.1.
4. Optional memory note about prompt-cache shape — already empirically verified `cachedInputTokens=0` on turn 1 (expected — fresh cache prefix); turn 2+ cache hits not yet measured. Consider running a 2-turn synthetic session and recording the cache hit telemetry as Phase 7 evidence.

### Cross-cutting cleanup (not in plan, surfaced during build)
1. **Phase 4 deferred polish** — items skipped to keep the v0 delivery small:
   - `home_nav_notes_badge` testTag + dashboard-level unread-count badge (would require adding a `/caregivers/{id}/care-notes/unread-count` fetch to `CaregiverDashboardViewModel` and surfacing it on the patient card row). Acceptable gap for v2.0 launch; revisit if user feedback says the per-screen tab badge isn't visible enough.
   - i18n strings for Hindi + Bengali on `CareNotesScreen.kt`. The current v2 caregiver screens use inline English strings (matches `AlertListScreen.kt`, `CareTeamScreen.kt`); a cross-cutting refactor for v2.1 would move them to `R.string.*` per the plan.
   - No detail screen with transcript snippet. Open question §5(2) deferred — decision was simple-detail-inline (list row carries all metadata + ack button). If the transcript snippet becomes a stakeholder ask, the cleanest add is a new endpoint on `bedrock-router` (it already owns session state) plus a `CareNoteDetailScreen.kt` that takes the noteId on the route.
2. **Pre-existing terraform plan check (task #4 from Phase 1)** — never explicitly verified `terraform plan` returns "No changes" after Phase 1 on dev/staging. Low priority since Phases 2 + 3 + 4 have since re-touched both envs via Terraform.

---

## 4. Where to look for context

| Topic | Source |
|---|---|
| Authoritative plan | `docs/care-notes-execution-plan.md` |
| PRD §6.9 (feature description) | `docs/matika_prd_v2.md` |
| Spec §5.1 (schema verbatim) | `docs/matika_spec_v2.md` |
| Spec §4.6 (API contract) | `docs/matika_spec_v2.md` |
| Spec §6.10 (conversation flow + sentinel-update) | `docs/matika_spec_v2.md` |
| DB migration | `backend/database/migrations/V016__care_notes.sql` |
| Care-notes lambda | `backend/lambdas/care-notes/{index.js,__tests__/index.test.js}` |
| Bedrock-router write path | `backend/lambdas/bedrock-router/src/{care_notes_recorder.ts,handler.ts}`, `prompts/system_v2.md` rule 14, `output_schema.json` actions enum |
| Android UI | `android/app/src/main/java/com/carelog/ui/relative/CareNotesScreen.kt`, `network/CloudApiService.kt` (Care Notes section), `dashboard/ui/CaregiverHomeScreen.kt` (Notes button), `ui/CareLogNavHost.kt` (route) |
| Maestro flow | `.maestro/flows/cg_v2_25_caregiver_care_notes.yaml` |
| Dev RDS tunnel | [[dev_rds_ssm_tunnel]] memory + `~/.matika-test-creds.env` |
| Staging RDS tunnel | bastion `i-0f2acdf1a96ee24a6`, port 55433, secret `carelog-staging-db-password`, DB `carelog_staging`, user `carelog_staging_admin` |
| Maestro authoring lessons | [[maestro_lessons]] memory |
| Idempotent-flow seeding | [[maestro_seed_before_idempotent_ack]] memory |

---

## 5. Suggested next-session entry point

1. Open this file (`docs/care-notes-progress-2026-05-25.md`).
2. Open `docs/care-notes-execution-plan.md` §3 Phase 5 (Disambiguation + test fixtures).
3. Start at Phase 5 task 1: add the second caregiver (John Smith) to Jane's care team on dev + staging. SQL pattern is in plan §4 Phase 5. Save as `backend/database/test_fixtures/care_notes_disambiguation_seed.sql` so it's reproducible.
4. Then ship the synthetic two-turn live test for the ambiguous → resolved sentinel-update path.
5. Stop after each phase per the execution plan's "stop after each phase's Done check" rule. Phases 5, 6, 7 are roughly independent; could be parallelized between sessions if useful.
