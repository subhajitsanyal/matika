# Care Notes — execution plan

**Created:** 2026-05-25 by Subhajit + Claude.
**Authoritative specs:** PRD §6.9 (`docs/matika_prd_v2.md`), Spec §5.1 / §4.6 / §6.10 (`docs/matika_spec_v2.md`).
**Surface:** Patient verbal asides during `patient_logging` sessions → persisted as `care_notes` rows → surfaced on a new caregiver Notes screen with disambiguation handling for spoken names.

This doc is the entry point for a fresh Claude Code session. Read PRD §6.9 + Spec §5.1, §4.6, §6.10 first (they are the contract). This plan describes **what to build, in what order, with which files** to satisfy that contract.

---

## 0. Why this feature exists

LV-V2-05 bench run on 2026-05-25 captured the pattern in production: patient said "can you tell my caregiver to add cholesterol on tracking" on turn 4 and Matika replied "Of course, Jane. I'll let your caregiver know that you'd like cholesterol added to your daily tracking." That ack is currently **theatre** — nothing is persisted, nothing reaches the caregiver. This feature makes the ack real.

Generalized substrate (not a one-off): the same `care_notes` table will hold Matika-agent observations (v2.1) and doctor-to-caregiver notes (Phase 2) under different `source` enum values. Building it as a generic substrate now avoids a rewrite later.

---

## 1. Acceptance gates (what "done" means)

A reviewer should be able to verify ALL of the following on staging before this feature is considered shipped:

1. **End-to-end voice capture.** Re-run LV-V2-05 voice flow on staging. The session that lands should produce **exactly one `care_notes` row** with `source='patient_request'`, `recipient_role='caregiver'`, `note_text` containing a third-person summary of the cholesterol request, `mentioned_name='caregiver'` (or null — no specific name was spoken), `disambiguation_status='resolved_default'` (defaulted to primary caregiver), `note_language='en-IN'`.
2. **End-to-end UI surface.** Caregiver logs in via the new bench Maestro flow `cg_v2_24_care_notes_browse.yaml`. The Notes screen loads, the LV-V2-05 row is visible with timestamp + source badge + recipient = "Self" + note_text, badge count on home = 1.
3. **Acknowledgment.** Tap the row → detail screen with the surrounding transcript snippet → tap Acknowledge → row moves to "Resolved" tab, badge count = 0, RDS `care_notes.acknowledged_at` and `acknowledged_by` populated with the caregiver user_id.
4. **Disambiguation — ambiguous.** Seed John CG to have a second caregiver named "John Smith" in Jane's care team (test fixture). Run a synthetic voice flow where the patient says "tell John to refill my prescription". The handler should detect 2 matches, the next turn's LLM response should ask "Did you mean John CG or John Smith?", the row should land with `disambiguation_status='ambiguous'` AND get **updated** (not duplicated) after the patient's clarifying turn. Verify single row at session end.
5. **Disambiguation — no_match.** Patient says "tell Aunt Padma to come over". No Padma in care team. Row lands with `disambiguation_status='no_match'`, `mentioned_name='Padma'`, `recipient_user_id=null`. The caregiver UI shows a "Named: Padma (not in care team)" tag.
6. **Tests.** Unit tests for `state_machine.test.ts` (no FSM change here) + new tests for handler care-note resolution logic + new tests for `care-notes` lambda endpoint set + at least 3 new Maestro journeys (browse, ack, ambiguous-resolution).
7. **No regressions.** All existing 399+ unit tests in `bedrock-router/__tests__/` still pass. Existing LV-V2-01..07 voice flows still PASS. F57 guard still suppresses premature `complete_session`. F58 + F59 fixes still apply.

---

## 2. Out of scope for this delivery

These are deliberately deferred so the surface ships cleanly. **Do not be tempted to fold them in.**

- **Agent-originated observations** (`source='matika_observation'`). The table accepts the enum value; no prompt path emits it yet. Plan a v2.1 follow-up that adds a prompt rule to the patient-logging system prompt for emitting `record_note` actions when the agent notices patient confusion / inconsistency / mild concern that doesn't trip emergency rules.
- **Doctor-recipient notes**. Schema supports `recipient_role='doctor'` but no doctor portal surface in v2.0. Don't wire any of the `GET /doctors/...` shape.
- **Push notifications on new notes.** Badge-only in v2.0. FCM push lands with v2.1 once Matika-emitted observations land.
- **Free-form caregiver reply-back to patient.** v2.0 captures only the binary ack.
- **Edit / undo on the patient side.** If the patient changes their mind mid-session, the LLM emits a new `record_note` superseding the prior one. No explicit undo action.

---

## 3. Phase ordering

Phases are sized so each one ends at a deployable checkpoint with verifiable behavior. Don't merge phases.

| # | Phase | Owner | Verifiable behavior at the end |
|---|---|---|---|
| 1 | DB migration + table | backend | `care_notes` table exists on dev + staging; indexes present; `terraform plan` clean |
| 2 | `care-notes` lambda (read + ack endpoints) | backend | `curl GET /patients/{id}/care-notes` returns `{ items: [] }` for Jane on staging; ack endpoint round-trips a manually-inserted row |
| 3 | Prompt + handler integration | backend (bedrock-router) | Voice or text run on LV-V2-05-style flow lands a `care_notes` row with the right shape; no regression on LV-V2-01..07 |
| 4 | Android caregiver UI | mobile | Caregiver navigates to Notes, sees the inserted row, taps Acknowledge, row moves to Resolved |
| 5 | Disambiguation + test fixtures | backend + tests | Ambiguous + no_match journeys land cleanly; the sentinel-update pattern in §6.10 works |
| 6 | Maestro journeys + bench evidence | qa-testing | At least 3 new `.maestro/flows/cg_v2_*` flows; LV-V2-05 re-runs and produces the expected care_notes row |
| 7 | Doc updates + memory pointers | doc | `docs/journeys_non_voice.md` adds CG-V2-24 + CG-V2-25 rows; `docs/voice_multi_turn_journeys.md` cross-references; memory note about prompt-cache shape |

---

## 4. Phase detail

### Phase 1 — DB migration

**Files to create:**
- `backend/database/migrations/V016__care_notes.sql` — schema exactly as Spec §5.1 (paste verbatim from spec; do not paraphrase).

**Pre-flight:**
- `flyway info` against dev — confirm V015 is the current head.
- Inspect existing FK CASCADE patterns in V015 to match the `ON DELETE CASCADE` / `ON DELETE SET NULL` choices in the spec.

**Apply order:**
1. Dev via SSM tunnel + `flyway migrate` (per `[[dev_rds_ssm_tunnel]]` memory).
2. Staging via the corresponding staging tunnel (bastion `i-0f2acdf1a96ee24a6`, port 55433 per `docs/benchmark-followup-v2.md`).
3. Verify the three indexes exist via `\di care_notes*` in psql.

**Done check:**
- `\d care_notes` shows expected columns on both envs.
- `terraform plan` from `infrastructure/terraform/environments/{dev,staging}/` returns "No changes" (migration is Flyway-managed, not Terraform).

### Phase 2 — `care-notes` Lambda + API routes

**Files to create:**
- `backend/lambdas/care-notes/index.js` — Node 20, AWS SDK v3, ~250 lines. Three handlers per Spec §4.6: list, ack, unread-count. Same `pg` client pattern as `doctor-patients` and `alert-crud`. Idempotent ack (recurring ack returns existing row).
- `backend/lambdas/care-notes/package.json` — mirror `alert-crud/package.json`.
- `backend/lambdas/care-notes/__tests__/index.test.js` — jest tests for: list with cursor pagination, ack idempotency, 403 on non-care-team caller, 404 on cross-patient note, unread-count fan-out across linked patients.

**Files to modify:**
- `infrastructure/terraform/modules/lambda/main.tf` — new `aws_lambda_function.care_notes` block following the `alert-crud` template. Include `prompts/` is not required (no prompt files here).
- `infrastructure/terraform/modules/api_gateway/main.tf` — three new routes:
  - `GET /patients/{patientId}/care-notes` → `care-notes` lambda
  - `POST /patients/{patientId}/care-notes/{noteId}/acknowledge` → `care-notes`
  - `GET /caregivers/{caregiverUserId}/care-notes/unread-count` → `care-notes`
- IAM: extend the `lambda_rds_cognito` inline policy to grant SELECT/INSERT/UPDATE on `care_notes`. The lambda also needs the existing RDS SELECT on `users` + `persona_links` (already granted).

**Deploy:**
- Per `[[lambda_naming_matika_prefix]]` memory: function names are `matika-{env}-care-notes`.
- Per `[[terraform_lambda_drift_pattern]]`: full terraform apply may revert unrelated drift. Use `-target=module.carelog.module.lambda.aws_lambda_function.care_notes` + `module.api_gateway.aws_apigatewayv2_route.care_notes_*` on dev first. Staging follows same pattern.

**Done check:**
- `aws lambda invoke --function-name matika-dev-care-notes --payload …` returns 200 on a synthetic list request.
- Manual `INSERT INTO care_notes` row in dev → `curl https://api.dev.matika.../patients/{patientId}/care-notes` with caregiver bearer token returns it.

### Phase 3 — Prompt + handler integration in `bedrock-router`

**Files to modify:**
- `backend/lambdas/bedrock-router/prompts/system_v2.md` — add the new conversation rule per Spec §6.10. Insert as a new numbered rule (numbering already at rule 13 post-F59; this becomes rule 14). Audit the F57 worked-example reference for stale numbering.
- `backend/lambdas/bedrock-router/src/context/loadPatientContext.ts` (or equivalent — verify exact file before editing) — inject the new `## Care team` block into the per-patient context. Query: `SELECT u.id, u.full_name, COALESCE(u.preferred_name, u.full_name) AS display_name, pl.relationship FROM persona_links pl JOIN users u ON u.id = pl.user_id WHERE pl.patient_id = $1 AND pl.is_active = true AND pl.relationship IN ('caregiver', 'relative') ORDER BY pl.created_at;` — note: confirm `users.preferred_name` exists on staging; the spec assumes it does. If not, ship a `V017` adding it as nullable text, default null.
- `backend/lambdas/bedrock-router/src/handler.ts` — after structured-output validation, add a `processCareNoteActions()` step. Implements the resolution flow from Spec §6.10. Owns the sentinel-update pattern for ambiguous → resolved transitions.
- `backend/lambdas/bedrock-router/output_schema.json` — extend the `actions[].type` enum to include `record_note` and add the four new fields (`noteText`, `mentionedName`, `recipientRole`, `noteLanguage`) under a discriminated-union shape. Validate against existing actions in the same file to keep the schema consistent.
- `backend/lambdas/bedrock-router/__tests__/handler.test.ts` — add a describe block covering: resolved (exact match), resolved_default (no name), ambiguous (multiple match → sentinel update on next turn), no_match (named but not in care team), 2-actions-per-turn cap, idempotent retry, empty noteText rejection.

**Prompt-cache management.** The care-team block must sit ABOVE the prompt-cache breakpoint (between system_v2.md and the per-patient context). Verify post-deploy with `model_call.cached_input_tokens > 0` on the second turn of a session. If cache misses, repack the cache-prefix order.

**Deploy:**
- Per `[[lambda_deploy_prompts_dir]]` memory: `prompts/` MUST be in the zip. `zip -rq /tmp/bedrock-router.zip dist node_modules prompts package.json output_schema.json` from `backend/lambdas/bedrock-router/`.
- Deploy to `matika-staging-bedrock-router` first; smoke a minimal session before any bench reruns.

**Done check:**
- New unit tests pass; existing 399+ still pass.
- Manual lambda invoke with a synthetic patient_logging turn payload containing the cholesterol-request shape produces a `record_note` action in the response AND a `care_notes` row in RDS.

### Phase 4 — Android caregiver UI

**Files to create:**
- `android/app/src/main/java/com/carelog/ui/relative/CareNotesScreen.kt` — top-level composable. Two tabs: Unacknowledged (default) + Resolved. List items per Spec §4.6 response shape. Pull-to-refresh; pagination via cursor.
- `android/app/src/main/java/com/carelog/ui/relative/CareNotesViewModel.kt` — Hilt + StateFlow. Calls the three new endpoints. Listens to a `NotesRefreshTrigger` SharedFlow so the badge refreshes when a new session ends.
- `android/app/src/main/java/com/carelog/ui/relative/CareNoteDetailScreen.kt` — detail view with transcript snippet (3 turns before / 3 after, joined from `interaction_sessions.transcript_history` via a new `GET /sessions/{sessionId}/transcript-snippet?around={turnIndex}&radius=3` endpoint — yes, this adds a tiny endpoint; decide in Phase 2 whether to bundle it into `care-notes` lambda or carve a separate endpoint on `bedrock-router`).
- `android/app/src/main/java/com/carelog/api/CareNotesApi.kt` — Retrofit interface.
- `android/app/src/main/java/com/carelog/data/CareNote.kt` — data classes matching the API response shape.

**Files to modify:**
- `android/app/src/main/java/com/carelog/CareLogNavHost.kt` — add `CareNotes` + `CareNoteDetail` destinations under the caregiver nav graph.
- `android/app/src/main/java/com/carelog/ui/relative/RelativeDashboardScreen.kt` — add the Notes entry to the nav drawer / bottom nav. Surface the unread-count badge (driven by the new `GET /caregivers/{id}/care-notes/unread-count` endpoint).
- `android/app/src/main/res/values/strings.xml` (+ `values-hi/`, `values-bn/`) — UI strings + tab labels + ack button + the "named: X (not in care team)" formatting string. Translations for Hindi + Bengali.

**testTags** (required for Maestro):
- `care_notes_screen`, `care_notes_tab_unacked`, `care_notes_tab_resolved`, `care_notes_list`, `care_note_row_${noteId}`, `care_note_ack_button`, `care_note_detail_back`, `care_note_detail_transcript`, `home_nav_notes_badge`.

**Done check:**
- Manual build + install on Samsung S21+. Caregiver login, tap Notes, see the seed row, tap, ack, see badge change.
- All 3 language packs render the date + source badge correctly (Bengali numerals where appropriate per `[[voice_harness_lessons]]` lesson 9).

### Phase 5 — Disambiguation + test fixtures

**Test fixture setup (one-time, both envs):**
- Add a second caregiver to Jane's care team named "John Smith" so ambiguous-resolution can be tested against the existing John CG. SQL:
  ```sql
  -- Run on dev + staging via SSM tunnel
  INSERT INTO users (email, full_name, role, cognito_sub)
    VALUES ('sanyalsubhajit2010+cg2@gmail.com', 'John Smith', 'caregiver', '<cognito-sub-from-manual-create>');
  INSERT INTO persona_links (patient_id, user_id, relationship, is_active)
    VALUES ('<jane-patient-id>', '<new-user-id>', 'caregiver', true);
  ```
- This requires a manual Cognito user creation in advance (or stub out the `users.cognito_sub` with a dev-only synthetic value — pick based on whether the test journeys need login as John Smith).
- Save the seed in `backend/database/test_fixtures/care_notes_disambiguation_seed.sql` so it's reproducible.

**Sentinel-update pattern verification:**
- Unit test the handler path that detects an ambiguous note and re-resolves it on the next turn — see Spec §6.10 step 4.
- Live verify with a synthetic two-turn lambda invoke (or a Maestro voice flow once Phase 6 lands).

### Phase 6 — Maestro journeys + bench evidence

**Files to create:**

1. `.maestro/flows/cg_v2_24_care_notes_browse.yaml` — caregiver logs in → opens Notes → asserts the LV-V2-05 row is visible → asserts unread-count badge = 1.
2. `.maestro/flows/cg_v2_25_care_notes_ack.yaml` — caregiver opens Notes → taps the row → taps Acknowledge → asserts row moves to Resolved tab → asserts badge count decremented.
3. `.maestro/flows/lv_v2_19_care_note_disambiguate_voice.yaml` — patient voice flow that says "tell John to refill my prescription" — asserts the LLM follow-up question fires on turn 2 — patient says "John CG" — asserts `care_notes` row at session end has `disambiguation_status='resolved'` + `recipient_user_id` = John CG's user_id (verified post-flow via SSM tunnel).

**Bench evidence requirements** (per `[[feedback_verify_live_pattern]]`):
- Each PASS must include: session UUID, CloudWatch RequestId for the turn that triggered `record_note`, RDS `care_notes` row dump.
- Reference these in the journey-row writeups in `docs/journeys_non_voice.md` and `docs/voice_multi_turn_journeys.md`.

### Phase 7 — Docs + memory

- `docs/journeys_non_voice.md` — add CG-V2-24 and CG-V2-25 rows.
- `docs/voice_multi_turn_journeys.md` — add LV-V2-19 row.
- `docs/testing_todos_v2.md` — close the F59 "Open question" about the cholesterol-request capture (this feature is the closure path); add a row noting agent-originated observations as deferred to v2.1.
- Save a memory note about the prompt-cache-shape requirement for the care-team block (cache-prefix ordering matters).

---

## 5. Open questions to resolve early

Resolve these in the first session after picking up this plan; do not defer:

1. **Does `users.preferred_name` exist on staging?** If not, ship V017 first. The prompt's care-team block reads it.
2. **Should the transcript-snippet endpoint live in `care-notes` lambda or `bedrock-router`?** Cleaner to put it in `bedrock-router` (it already owns session state) but adds a new route to a critical lambda. Argues for splitting into `session-readonly` if growth continues. Pick one and document.
3. **Multi-patient caregivers — note filtering UX.** John CG has only Jane for v2.0. But the data model supports multi-patient (and the unread-count endpoint fans out across patients). Should the Notes screen default to "all patients" or per-patient? Decide before UI work in Phase 4.
4. **Ambiguous-resolution timeout.** What if the patient never answers the disambiguation question? Spec §6.10 says the row stays ambiguous and the caregiver UI surfaces it. Confirm that's acceptable (vs. auto-resolving to primary caregiver after N turns).
5. **Note rate-limit per session.** §6.4 caps at 2 record_notes per turn. Per-session there's no cap — is that right? A 15-turn session could produce 30 notes. Set a per-session cap of (say) 5 and document.
6. **Language tag for noteText when patient code-switches.** If the patient says "tell my daughter to bring my goli (medicine)" — what's the note_language? Probably the session language tag (en-IN if that's what the session is in), with mixed-language content allowed inside note_text. Confirm.

---

## 6. Useful references

- **PRD §6.9** (`docs/matika_prd_v2.md`) — feature description, acceptance criteria, out-of-scope list.
- **Spec §5.1** — `care_notes` table schema (verbatim — paste into the V016 migration).
- **Spec §4.6** — API contract for the three new endpoints.
- **Spec §6.10** — conversation engine flow, prompt rule, handler post-processing including the sentinel-update pattern.
- **Lambda naming** — `[[lambda_naming_matika_prefix]]` memory: it's `matika-{env}-care-notes`, NOT `carelog-*`.
- **Deploy packaging** — `[[lambda_deploy_prompts_dir]]` memory: `prompts/` must be in the zip for bedrock-router; not needed for `care-notes` itself.
- **Live verification protocol** — `[[feedback_verify_live_pattern]]` memory: RDS row + CloudWatch log + session UUID for every fix claim.
- **CG-V2-16 cascade ownership map** (`[[cg_v2_16_cascade_pattern]]`) — relevant when delete-patient runs against a patient with `care_notes` rows; the spec's `ON DELETE CASCADE` on `care_notes.patient_id` handles cleanup, but verify after Phase 1 that delete-patient still passes its cascade test.
- **Voice harness lessons** (`[[voice_harness_lessons]]`) — required reading before Phase 6 bench runs (remote-TTS, F41 sidestep, Samsung-vs-Pixel logcat trigger pattern).

---

## 7. Suggested first action

Open this file. Open `docs/matika_prd_v2.md` to §6.9. Open `docs/matika_spec_v2.md` to §5.1, §4.6, §6.10. Read in that order. Then start Phase 1 — write `V016__care_notes.sql` and apply against dev.

Stop after each phase's "Done check" passes. Do not chain into the next phase without verifying the current one against the criteria in §1.

---

*This plan was written 2026-05-25 after the LV-V2-05 bench captured the F59 cross-mapping bug AND surfaced the missing feature: Matika was acknowledging requests it had no path to fulfill. Both are now addressed — F59 by prompt edit (shipped 2026-05-25, see `docs/testing_todos_v2.md` F59 RESOLVED), and the missing-feature half by this plan.*
