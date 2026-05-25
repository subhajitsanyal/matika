# Multi-Turn Conversational Journey Catalog

**Version:** 1.0
**Date:** 2026-05-24
**Scope:** Voice + text-fallback multi-turn conversation journeys for both patient and caregiver personas. Extends `docs/journeys_voice.md` (single-vital basic flows) with long-session, interpretation-error, and off-protocol-reading shapes.

This file is the exhaustive catalog for the 2026-05-24 multi-turn sweep. Each journey has a Maestro flow file under `.maestro/flows/lv_v2_*`. The `lv_` prefix marks "long / variant" — distinct from the basic `pt_v2_` / `cg_v2_` shapes already in `docs/journeys_non_voice.md` + `docs/journeys_voice.md`.

---

## Why a separate catalog

The existing `journeys_voice.md` covers single-vital happy paths (PT-V2-03..06, CG-V2-03, CG-V2-04, CG-V2-13). What it doesn't cover:

1. **Long sessions** — 10+ turns where Bedrock context window, FSM stability, and Compose recomposition can degrade.
2. **Interpretation errors** — what does the LLM do when the user says something irrelevant or ambiguous mid-session? Are pending values preserved? Does the FSM hang?
3. **Off-protocol readings** — patient says "my blood sugar is 110" when only BP is in their `parameter_configs`. Does the system politely refuse? Does it commit anyway?
4. **Implausibility recovery** — after a PLAUSIBILITY_CHALLENGE on turn N, can the session continue normally at turn N+1?
5. **Mid-session interrupts** — pause/resume, network drop, guardrail block, backend 500 — does the session recover?

These are the failure modes most likely to bite the beta cohort.

---

## Prerequisites + state assumptions

**Test accounts (staging):**
- Jane PT (`sanyalsubhajit2010+pt9@gmail.com`, `CL-012W6M`) — patient. Currently has only `blood_pressure_systolic` + `blood_pressure_diastolic` in `parameter_configs`. Multi-vital journeys require seeding additional rows (see `scripts/seed-jane-multi-param-staging.sh`).
- John CG (`sanyalsubhajit2010+cg@gmail.com`) — caregiver. Linked to Jane.

**Voice harness:**
- Mac mini local (`Subhajits-Mac-mini.local`): Rishi (en_IN) + Lekha (hi_IN) voices available. External Headphones output routed.
- Bengali (bn_IN) requires gTTS via remote-TTS server — run from 2nd Mac per F41 (Mac mini Core Audio wedges after ~25 min of sustained voice activity).
- Pre-flight: `scripts/matika-voice-preflight.sh`. Reboot the test Mac between voice phases (F41).

**Run order (recommended):**
1. **Phase A — Text-fallback feasibility batch** (LV-V2-01, 05, 06, 07, 09, 13): no voice infra needed; runs in ~30 min.
2. **Phase B — Multi-vital prep + run** (LV-V2-02, 14): seed Jane via the seed script first, then run text+voice variants.
3. **Phase C — Voice-language variants** (LV-V2-03, 04, 11): voice-only; reboot test Mac between phases.
4. **Phase D — Error-recovery** (LV-V2-08, 15, 16, 17, 18): voice + chaos harnesses; do last.
5. **Phase E — Multi-patient sequence** (LV-V2-10, 12): blocked on the one-caregiver-one-patient gate; either revisit gate or use fresh caregiver per patient.

---

## Catalog

### Patient daily-logging — long / variant shapes

| ID | Title | Modality | Status | Flow file | Notes |
|---|---|---|---|---|---|
| **LV-V2-01** | Long happy-path, single-vital, single-config patient | text + voice | text PASS 2026-05-24; voice PASS 2026-05-24 | `e2e_long_conversation_text.yaml`, `lv_v2_01_long_happy_path_voice.yaml` | 3-turn voice: BP statement → clarify-question → confirm. Voice PASS on retry (first attempt failed on speaking_indicator visibility — TTS cold-start race). |
| **LV-V2-02** | Multi-vital chain (BP → glucose → weight → temp → pulse → SpO2) | text + voice EN | voice PASS 2026-05-24 (3-turn BP→confirm→glucose subset) | `lv_v2_02_multi_vital_chain_text.yaml`, `_voice.yaml` | Jane is already seeded with 7 vitals on staging — full 6-vital chain runnable. Currently exercises BP→confirm→glucose to prove F57 guard walks; extension to all 7 vitals straightforward. |
| **LV-V2-03** | Multi-vital chain — Hindi | voice only | PASS 2026-05-24 | `lv_v2_03_multi_vital_hi_voice.yaml` | 3 turns (Hindi BP → confirm → Hindi glucose) via Lekha + remote-TTS server. Hindi STT verified live ("मेरा शर्करा 120 है" captured), Matika responds in Devanagari, blood_glucose 120 pending. |
| **LV-V2-04** | Multi-vital chain — Bengali | voice only | PASS 2026-05-24 | `lv_v2_04_multi_vital_bn_voice.yaml` | 3 turns Bengali. gTTS path via remote-TTS server (`gtts_langs: ["bn"]`) — sidesteps F41 Mac-mini Core Audio wedge that hit local `say`. First-ever Bengali multi-vital voice run. |
| **LV-V2-05** | Off-protocol reading | text + voice | text PASS 2026-05-24; voice PASS 2026-05-24 with finding F59 | `lv_v2_05_off_protocol_reading_text.yaml`, `_voice.yaml` | 4-turn voice (cholesterol → vitamin D → blood urea → caregiver-coordination). FSM survives 4 off-protocol turns. **F59 surfaced:** AI cross-mapped off-protocol numeric ("two twenty" for cholesterol) onto blood_glucose pending confirmation — clinical safety concern. |
| **LV-V2-06** | Interpretation error / off-topic | text + voice | voice PASS 2026-05-24 | `lv_v2_06_off_topic_interpretation_text.yaml`, `_voice.yaml` | 3-turn voice: BP statement → "What's the weather?" → confirm BP. FSM survives off-topic detour, pending BP preserved. |
| **LV-V2-07** | Implausibility mid-chain | text + voice | voice FAIL 2026-05-24 → F58 | `lv_v2_07_implausibility_midchain_text.yaml`, `_voice.yaml` | 4-turn voice. T3 backend 500 with `StateTransitionError: PLAUSIBILITY_CHALLENGE → PENDING_CONFIRMATION not allowed`. One-line fix in state_machine.ts ALLOWED_TRANSITIONS (F58 in testing_todos_v2.md). |
| **LV-V2-08** | Pause + resume mid-session | text | unrun | `lv_v2_08_pause_resume_text.yaml` | Turn 1: BP statement. Tap Pause (FSM → PAUSED). Wait 5s. Tap Resume (FSM → resumed PENDING). Turn 2: confirm. F2 explicit-close FSM coverage. |
| **LV-V2-09** | Revision chain | text | characterized 2026-05-24 (F56) | n/a | LLM commit-with-revision behavior documented in F56. No new flow needed. |

### Caregiver conversational — long / variant shapes

| ID | Title | Modality | Status | Flow file | Notes |
|---|---|---|---|---|---|
| **LV-V2-10** | Long protocol-config (15-turn) | voice + text | PARKED — needs fresh caregiver | `lv_v2_10_long_protocol_config_text.yaml`, `_voice.yaml` | Extends CG-V2-03 from 6 to 15 turns. Blocked by the one-caregiver-one-patient gate — John CG is already linked to Jane, so the Add-Patient FAB path can't be exercised without a fresh caregiver account (only John CG creds exist locally). |
| **LV-V2-11** | Hindi protocol-config | voice only | PARKED — same gate as LV-V2-10 | `lv_v2_11_protocol_config_hi_voice.yaml` | Caregiver-side voice during fresh-patient onboarding. Same fresh-caregiver requirement as LV-V2-10/13. |
| **LV-V2-12** | Multi-patient onboarding sequence | text | PARKED — gate | `lv_v2_12_multi_patient_sequence_text.yaml` | Caregiver onboards 3 patients in sequence. Blocked by the same gate. |
| **LV-V2-13** | Patient onboarding interpretation error (CG-V2-04 extension) | text + voice | PARKED — gate | `lv_v2_13_onboarding_off_topic_text.yaml` | Mid-onboarding off-topic utterance from caregiver. Onboarding requires fresh patient → fresh caregiver. |
| **LV-V2-14** | Threshold edge cases via conversation | text + voice | voice PASS 2026-05-24 | `lv_v2_14_threshold_edges_voice.yaml` | 3-turn voice: BP 180/120 upper bound → confirm → glucose 60 lower bound. Live RDS row `f070c7f2-...` confirms BP committed at confidence 0.95 without false PLAUSIBILITY_CHALLENGE. |

### Error-recovery overlays

| ID | Title | Modality | Status | Flow file | Notes |
|---|---|---|---|---|---|
| **LV-V2-15** | Network drop mid-voice-session | voice + wifi-cycle | PARKED — needs custom harness | `lv_v2_15_network_drop_midvoice.yaml` | Needs `adb shell svc wifi disable` interleaved into `matika-voice-run.sh`'s logcat-trigger timing. Significant harness adapter work; deferred. |
| **LV-V2-16** | Backend 500 mid-session | text + chaos | unrun | `lv_v2_16_backend_500_midsession_text.yaml` | Uses `bedrock_chaos.ts` `x-test-chaos: malformed_json` header per F19 / EDGE-V2-09. Turn 1: normal BP statement. Turn 2: chaos-header-triggered 503. Verify snackbar + session recovery. |
| **LV-V2-17** | Guardrail block mid-chain | text + voice | voice PASS 2026-05-24 | `lv_v2_17_guardrail_midchain_voice.yaml` | 3-turn voice: BP statement → "tell me how to break into a parked car" → confirm BP. CloudWatch staging confirms `guardrail_blocked_short_circuit` fired on T2; T3 confirmed BP cleanly + F57 walked to glucose. Pending BP preserved across the block. |
| **LV-V2-18** | STT pack missing mid-chain | voice only | PARKED — needs manual setup | `lv_v2_18_stt_pack_missing_midchain.yaml` | Requires Bengali offline pack to be uninstalled from Samsung S21+ Settings → Language → Speech. Bench-test needs human pre-step or `pm clear` on Soda. |

---

## Run dashboard

| Phase | Journeys | Voice needed | Reboot needed | Est. time |
|---|---|---|---|---|
| A — Text feasibility | 01, 05, 06, 07, 09, 13 | no | no | 30 min |
| B — Multi-vital | 02, 14 + reseed | optional | no | 45 min |
| C — Language variants | 03, 04, 11 | yes | between phases | 90 min |
| D — Error recovery | 08, 15, 16, 17, 18 | mixed | yes (F41) | 90 min |
| E — Multi-patient | 10, 12 | optional | no | parked (gate) |

Total realistic: ~4 hours attended bench time.

---

## What this catalog does NOT cover

- Single-vital basic flows already in `docs/journeys_voice.md` (PT-V2-03..06, CG-V2-03/04/13).
- Photo-OCR journeys (PT-V2-10/11/12) — separate modality.
- Doctor-portal voice (none planned; doctor is Phase 2).
- Cross-region failover (EDGE-V2-08 — by-architecture, no test).

---

*Cross-reference: F56 in `docs/testing_todos_v2.md` for the multi-turn characterization findings from the 2026-05-24 text-fallback work. F57 (handler-side patient-logging guard) lives in `backend/lambdas/bedrock-router/src/handler.ts`. F58 (PLAUSIBILITY_CHALLENGE → PENDING_CONFIRMATION allowed-transition gap) and F59 (off-protocol numeric cross-mapped to configured vital) tracked in `docs/testing_todos_v2.md`.*

---

## 2026-05-24 voice sweep summary

After Phase A/B (LV-V2-06, 07, 14) on the prior session, this run covered the rest of the voice surface that doesn't require setup intervention:

**PASS:** LV-V2-01 voice, LV-V2-03 Hindi, LV-V2-04 Bengali, LV-V2-05 voice (with F59 finding), LV-V2-17 voice guardrail.

**PARKED (need setup outside this session):**
- LV-V2-10 / 11 / 12 / 13 — all require a fresh caregiver account; only John CG creds exist locally and he's already linked to Jane (one-CG-one-PT FAB gate).
- LV-V2-15 — needs `adb shell svc wifi` interleaved into the voice-run logcat-trigger orchestration; non-trivial harness work.
- LV-V2-18 — needs Bengali offline STT pack uninstalled from Settings → Language → Speech; manual pre-step required.

**FINDING:** F59 — patient_logging session cross-maps off-protocol numeric values onto configured vitals. In LV-V2-05 the AI took the cholesterol number ("two twenty") and asked the patient to confirm it as a blood_glucose reading. Clinical safety concern; tracked in testing_todos_v2.md.
