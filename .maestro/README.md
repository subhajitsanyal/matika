# Maestro UI tests

Automated device-side smoke tests for the Matika v2 Android client.
Replaces the manual loop documented in
`docs/android_v2_smoke_test_runbook.md`. The runbook still applies for
first-time device setup (offline STT/TTS packs, RECORD_AUDIO grant);
this directory is for reproducible flow runs after that.

## Install

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
maestro --version
```

## Credentials

Flows authenticate against Cognito. Put real test creds in a local,
gitignored env file — never commit them:

```bash
cat > ~/.matika-test-creds.env <<'EOF'
export MATIKA_CAREGIVER_EMAIL='sanyalsubhajit2010+cg@gmail.com'
export MATIKA_CAREGIVER_PASSWORD='<the dev caregiver password>'
export MATIKA_PATIENT_EMAIL='sanyalsubhajit2010+pt@gmail.com'
export MATIKA_PATIENT_PASSWORD='<the dev patient password>'
EOF
chmod 600 ~/.matika-test-creds.env
```

## Run a flow

```bash
source ~/.matika-test-creds.env
maestro test .maestro/flows/caregiver_protocol_setup.yaml
```

Or run all flows:

```bash
source ~/.matika-test-creds.env
maestro test .maestro/flows
```

A connected device or running emulator is required (`adb devices`
should list one).

## Flows

| File | What it covers |
|---|---|
| `flows/caregiver_protocol_setup.yaml` | Caregiver signs in, adds a new patient with a unique email (timestamped to avoid Cognito UsernameExistsException), runs the v2 protocol-config conversation via the text-input fallback, verifies the "Session complete" card shows parameters/topics counts. Phase C end-to-end. |
| `flows/patient_logging_happy_path.yaml` | Patient signs in, opens conversation screen, logs BP via text-input fallback, confirms the value, verifies the FHIR-write completion card. Phase A end-to-end. |

## What to do when a flow breaks

1. Run `maestro test --debug-output /tmp/maestro-debug` to capture
   screenshots + view hierarchy at each step.
2. Look at `/tmp/maestro-debug/<run-id>/` — screenshots of each step
   and the failure point.
3. If the breakage is a missing element selector, add a
   `Modifier.testTag("...")` to the Composable in the Android source,
   then update the flow to use `id: "..."` selector. Robust against
   text label changes.

## Writing new flows

- Prefer `tapOn: "Visible Text"` for buttons/labels that don't change.
- Use `tapOn: { id: "test_tag" }` for icon-only buttons or things that
  could be text-shifted.
- Use `inputText: "..."` to type into the focused field. Pair with
  `tapOn` on the field first to focus it.
- Use `assertVisible: "text"` to verify a state. Cheap and robust.
- Pull dynamic values (timestamps for unique emails) via
  `runScript: file: scripts/<name>.js` — Maestro supports JS hooks.
