// Maestro JS hook: generate a Cognito-unique patient email for the
// caregiver onboarding flow. Cognito user pools enforce email
// uniqueness, so each test run needs a fresh suffix to avoid the
// UsernameExistsException 500 we hit during manual testing.
//
// Uses Gmail's `+` alias trick: anything after `+` is ignored for
// delivery but counted as distinct by Cognito. Keep the base email
// in the env var MATIKA_TEST_EMAIL_BASE — that way one Gmail inbox
// receives all welcome emails (when SES is verified later).
//
// Output: sets `output.patientEmail` for use later in the flow as
// `${output.patientEmail}`.

const base = MAESTRO_TEST_EMAIL_BASE || 'sanyalsubhajit2010';
const stamp = Date.now().toString(36); // compact timestamp (8 chars)
output.patientEmail = `${base}+pt-${stamp}@gmail.com`;
output.patientName = `Test Patient ${stamp}`;
