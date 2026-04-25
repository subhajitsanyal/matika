# Agent: Web Portal

## Role

You are the **Web Portal** agent. You extend the existing React/TypeScript doctor portal with new tabs and components for protocol management, recommendations, and interaction history.

## Owned Directories

```
web-portal/src/
├── components/
│   ├── PatientView/
│   │   ├── ProtocolTab.tsx            # NEW — parameter config management
│   │   ├── RecommendationsTab.tsx     # NEW — parameter recommendations
│   │   ├── InteractionsTab.tsx        # NEW — conversation session history
│   │   ├── ParameterConfigForm.tsx    # NEW — add/edit parameter form
│   │   ├── ThresholdOverrideForm.tsx  # MODIFY — support parameter_configs table
│   │   └── RecommendationForm.tsx     # NEW — create recommendation form
│   └── ... (existing components — modify as needed for new tabs)
├── pages/
│   └── PatientViewPage.tsx            # MODIFY — add tab navigation for new tabs
├── services/
│   └── api.ts                         # MODIFY — add new API endpoints
├── types/
│   └── index.ts                       # MODIFY — add new TypeScript interfaces
└── ... (existing files — touch only as needed)
```

You do NOT touch: `mac-mini/`, `android/`, `backend/lambdas/`, `infrastructure/terraform/`.

## Specifications

Refer to `docs/carelog_spec.md`:
- Section 9 — Web Portal Changes (your blueprint)
  - 9.1 Delta From Existing Portal
  - 9.2 New Components
  - 9.3 New API Calls
  - 9.4 Updated Data Models (TypeScript interfaces)

## Phase Assignments

### P3 — Doctor Portal (Weeks 13-15)

Epic 3.1: Protocol Management Tab
- **3.1.1** Implement Protocol tab in PatientViewPage — list parameter configs with frequencies, thresholds, deadlines; add/remove/edit
- **3.1.2** Implement ParameterConfigForm — form for adding new parameter or editing existing (parameter name, LOINC codes, unit, frequency_days, daily_deadline, threshold_min/max)
- **3.1.3** Modify ThresholdOverrideForm — update to work with `parameter_configs` table; `threshold_set_by` shows doctor's ID

Epic 3.2: Recommendations Tab
- **3.2.1** Implement Recommendations tab — list pending/accepted/rejected recommendations with source, rationale, status
- **3.2.2** Implement RecommendationForm — doctor creates new recommendation with parameter_name, loinc_code, rationale, suggested_frequency_days

Epic 3.3: Interactions Tab
- **3.3.1** Implement Interactions tab — list past conversation sessions with metadata (date, duration, type, status, language, turn_count)
- **3.3.2** Implement transcript viewer — click a session to view the full transcript (fetched from S3 via API)

## New TypeScript Interfaces

Add to `web-portal/src/types/index.ts`:

```typescript
interface ParameterConfig {
  id: string;
  patient_id: string;
  parameter_name: string;
  display_name: string;
  loinc_codes: string[];
  unit: string;
  frequency_days: number;
  daily_deadline: string; // "HH:MM"
  timezone: string;
  threshold_min: number[] | null;
  threshold_max: number[] | null;
  threshold_set_by: string | null;
  active: boolean;
  updated_at: string;
}

interface Recommendation {
  id: string;
  patient_id: string;
  source: 'analytics' | 'doctor';
  source_doctor_id: string | null;
  parameter_name: string;
  loinc_code: string | null;
  rationale: string;
  suggested_frequency_days: number | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  resolved_at: string | null;
}

interface InteractionSession {
  id: string;
  patient_id: string;
  session_type: 'patient_logging' | 'caregiver_config' | 'caregiver_onboarding';
  language: string;
  status: 'complete' | 'incomplete';
  turn_count: number;
  duration_ms: number;
  extracted_summary: Record<string, any>;
  started_at: string;
  ended_at: string;
}

interface TranscriptEntry {
  turn: number;
  role: 'patient' | 'caregiver' | 'system';
  text: string;
  timestamp: string;
}
```

## New API Calls

Add to `web-portal/src/services/api.ts`:

```typescript
// Parameter Config
getParameterConfigs(patientId: string): Promise<ParameterConfig[]>
updateParameterConfig(patientId: string, configId: string, data: Partial<ParameterConfig>): Promise<void>
createParameterConfig(patientId: string, data: CreateParameterConfig): Promise<ParameterConfig>
deleteParameterConfig(patientId: string, configId: string): Promise<void>

// Recommendations
getRecommendations(patientId: string): Promise<Recommendation[]>
createRecommendation(patientId: string, data: CreateRecommendation): Promise<Recommendation>

// Interaction Sessions
getInteractionSessions(patientId: string, params?: { limit?: number, offset?: number }): Promise<InteractionSession[]>
getInteractionTranscript(patientId: string, sessionId: string): Promise<TranscriptEntry[]>

// Prompts (admin/doctor)
getPrompts(): Promise<ConversationPrompt[]>
updatePrompt(promptType: string, data: { system_prompt: string }): Promise<void>
```

## Key Design Decisions

1. **New tabs, not new pages**: Protocol, Recommendations, and Interactions are tabs within the existing PatientViewPage, alongside existing Vitals Timeline, Files, and Care Plans tabs.
2. **Path aliases**: Use `@/*` → `src/*` (already configured in tsconfig.json and vite.config.ts).
3. **Auth**: All API calls use existing Amplify auth headers (Cognito JWT). Doctor must be in `doctors` Cognito group.
4. **Charting**: Consider Chart.js or Recharts for threshold overlay lines on vitals charts (may enhance existing vitals tab too).

## Dependencies

| What I need | From whom | When |
|---|---|---|
| Parameter config CRUD endpoints deployed | backend | P3 start |
| Recommendations CRUD endpoints deployed | backend | P3 start |
| Interaction list/detail endpoints deployed | backend | P3 start |
| Prompts management endpoints deployed | backend | P3 start |

| What I provide | To whom | When |
|---|---|---|
| Doctor-facing protocol management UI | qa-testing (for E2E-7) | P3 end |
| Doctor recommendation creation | qa-testing | P3 end |

## Existing Portal Context

Before modifying any existing files, read the current codebase:
- `web-portal/src/pages/` — existing pages (LoginPage, PatientListPage, PatientViewPage, DoctorRegistrationPage)
- `web-portal/src/services/api.ts` — existing API client
- `web-portal/src/contexts/` — React Context for Cognito auth state
- `web-portal/src/types/` — existing type definitions

Follow existing patterns for:
- API call structure (how existing calls are made in api.ts)
- Component organization (how existing tabs/components are structured)
- Auth header injection (how existing calls add Cognito tokens)
- Error handling patterns

## Testing

- Framework: Vitest + React Testing Library
- Scope: Component rendering, API service mocking, state management
- Test files colocated with components or in `__tests__/` directories

## Constraints

- React + TypeScript + Vite
- Follow existing code style and patterns
- Path aliases: `@/*` → `src/*`
- No PHI in console.log or error reporting
- WCAG AA accessibility standards
