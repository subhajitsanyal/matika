# Gap-implementation kickoff prompt

Paste the block below as the first message of a new Claude session to pick up where the 2026-05-10 sweep left off and start working through `docs/v2_gap_plan.md`.

---

```
Continuing Matika v2 from prior testing sweeps. We've completed one
round of non-voice + voice testing. 19 of 71 journeys verified
end-to-end; 13 findings open across compliance, infra, code, and UI
gaps.

Authoritative state:
1. docs/v2_gap_plan.md — 4-phase implementation plan ranked by
   severity + journeys-unblocked-per-day. Start there.
2. docs/testing_todos_v2.md — per-finding detail (reproduction, fix
   sketches, verification evidence). F-numbers are the canonical IDs.
3. docs/journeys_non_voice.md + docs/journeys_voice.md — per-journey
   PASS / blocked status with last-evidence timestamps.
4. MEMORY.md (auto-loaded) — bench setup, dev RDS access, test
   accounts, and lessons that bit during prior sweeps.

Begin Phase 1 of the gap plan. Five hard-stops in priority order:
F19 (1-2h, smallest), F18, F1, F2, F17 (~1d, biggest). Phase 1 flips
the pilot from "demo-ready" to "pilot-ready" — compliance + push +
two telemetry holes.

Start with F19 (bedrock-router parser doesn't handle Bedrock
Guardrail intervention — every blocked input today returns HTTP 500
instead of the configured blocked_input_messaging). Read the F19
entry in docs/testing_todos_v2.md for reproduction + fix sketch, then
fix it following the fix-then-verify-live pattern (jest regression
test that pins the behavior, deploy via aws lambda update-function-
code to keep blast radius narrow per the cognito-drift note in F11,
replay against live to confirm the previously-failing input now
returns 200 with the configured blocked-message copy).

Leverage the team of agents already available to you. 
Confirm with me before each F-number transition — I want to review
the live-verification evidence for one finding before you move to
the next.
```

