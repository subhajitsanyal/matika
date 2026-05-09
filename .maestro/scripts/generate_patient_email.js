// Maestro JS hook: pick the patient email + name for the caregiver
// onboarding flow.
//
// Default behaviour (no overrides) generates a Cognito-unique email
// via Gmail's `+` alias trick + a timestamp suffix, so the flow is
// idempotent across CI runs.
//
// Overrides (passed via --env from scripts/maestro-run.sh):
//   MATIKA_FORCE_PATIENT_EMAIL  - use this exact email instead of an alias
//   MATIKA_FORCE_PATIENT_NAME   - use this exact name instead of "Test Patient <stamp>"
//
// Use overrides for test-data setup runs where the resulting account
// will be used by downstream patient-side journeys (matika-test-creds.env).
//
// Output: sets `output.patientEmail` and `output.patientName` for use
// later in the flow as `${output.patientEmail}` etc.

if (typeof MATIKA_FORCE_PATIENT_EMAIL !== 'undefined' && MATIKA_FORCE_PATIENT_EMAIL) {
    output.patientEmail = MATIKA_FORCE_PATIENT_EMAIL;
    output.patientName =
        (typeof MATIKA_FORCE_PATIENT_NAME !== 'undefined' && MATIKA_FORCE_PATIENT_NAME)
            ? MATIKA_FORCE_PATIENT_NAME
            : 'Test Patient';
} else {
    const base =
        (typeof MATIKA_TEST_EMAIL_BASE !== 'undefined' && MATIKA_TEST_EMAIL_BASE)
            ? MATIKA_TEST_EMAIL_BASE
            : 'sanyalsubhajit2010';
    const stamp = Date.now().toString(36);
    output.patientEmail = `${base}+pt-${stamp}@gmail.com`;
    output.patientName = `Test Patient ${stamp}`;
}
