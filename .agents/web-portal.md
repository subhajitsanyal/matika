# Agent: Web Portal

## Role

You are the **Web Portal** agent. You extend the existing React/TypeScript doctor portal with new tabs and components for protocol management, recommendations, interaction history, and (new in v2) cost & telemetry visibility for admins.

## Owned Directories

```
web-portal/src/
├── components/
│   ├── PatientView/
│   │   ├── ProtocolTab.tsx                # parameter config management
│   │   ├── RecommendationsTab.tsx         # parameter recommendations
│   │   ├── InteractionsTab.tsx            # conversation session history
│   │   ├── ParameterConfigForm.tsx
│   │   ├── ThresholdOverrideForm.tsx
│   │   └── RecommendationForm.tsx
│   ├── Admin/                              # NEW in v2
│   │   ├── CostTelemetryTab.tsx           # NEW — daily per-patient Bedrock cost dashboard
│   │   ├── EscalationsTab.tsx             # NEW — escalation breakdown by reason and tier
│   │   ├── LatencyTab.tsx                 # NEW — P50/P95/P99 by tier and language
│   │   └── CostChart.tsx
│   └── ... (existing components)
├── pages/
│   ├── PatientViewPage.tsx                # tab navigation for protocol, recommendations, interactions
│   └── AdminTelemetryPage.tsx             # NEW — admin-only entry to cost/escalations/latency tabs
├── services/
│   ├── api.ts                              # API service client
│   └── telemetry.ts                        # NEW — admin telemetry API client
├── types/
│   └── index.ts                            # TypeScript interfaces
└── ... (existing)
```

You do NOT touch: `android/`, `backend/lambdas/`, `infrastructure/terraform/`, `inference-platform/`.

## Specifications

Refer to `docs/matika_spec_v2.md`:
- Section 9 — Web Portal Changes
  - 9.1 Delta from v1 (Admin tab is new)
  - 9.2 New API Calls (telemetry endpoints added)

## Phase Assignments

### P3 — Doctor Portal (Weeks 9–11)
- **[T-V2-330] (delta)** Existing v1 work — Protocol / Recommendations / Interactions tabs — proceeds unchanged.
- Add small "Last session telemetry" card on patient detail page showing tier breakdown + region (read-only, doctor-visible).

### P4 — Integration & Polish (Weeks 12–14)
- **[T-V2-421]** Admin "Cost & Telemetry" tab.
- **[T-V2-422]** Latency dashboard tab.
- Escalation breakdown tab.

## New TypeScript Interfaces (additions in v2)

Add to `web-portal/src/types/index.ts`:

```typescript
interface CostTelemetry {
  patientId: string;
  day: string;             // ISO date
  haikuCalls: number;
  sonnetCalls: number;
  visionHaikuCalls: number;
  visionSonnetCalls: number;
  ocrLocalCalls: number;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

interface ModelCall {
  id: string;
  sessionId: string;
  patientId: string;
  tier: 'T2' | 'T3' | 'T2_VISION' | 'T3_VISION';
  model: string;
  streamed: boolean;
  guardrailBlocked: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  inferenceRegion: string;
  escalationReason: string | null;
  costUsd: number;
  createdAt: string;
}

interface EscalationSummary {
  reason: string;          // e.g., 'implausible_value', 'emergency'
  count: number;
  costUsd: number;
}

interface LatencyPercentiles {
  tier: 'T2' | 'T3' | 'T2_VISION' | 'T3_VISION';
  language: string;
  p50: number;
  p95: number;
  p99: number;
  sampleSize: number;
}
```

(All v1 interfaces — `ParameterConfig`, `Recommendation`, `InteractionSession`, etc. — remain unchanged.)

## New API Calls (additions in v2)

Add to `web-portal/src/services/telemetry.ts`:

```typescript
getCostTelemetry(params: { patientId?: string; from: string; to: string }): Promise<CostTelemetry[]>
getCostAggregate(params: { from: string; to: string }): Promise<{ totalCostUsd: number; perPatient: CostTelemetry[] }>
getEscalations(params: { from: string; to: string }): Promise<EscalationSummary[]>
getLatencyPercentiles(params: { from: string; to: string }): Promise<LatencyPercentiles[]>
```

All admin endpoints require Cognito group `admins`.

## Key Design Decisions

1. **Admin tab is gated**: Cognito `admins` group required. The link only appears for users with that group claim.
2. **No PHI in admin views**: Cost and telemetry views show patient IDs (UUIDs) by default; mapping to patient names is a separate authenticated lookup the admin must explicitly trigger.
3. **Date range is the primary control**: All admin views default to "last 7 days". Charts are server-aggregated to keep client payloads small.
4. **No real-time streaming**: Admin tabs are dashboards over `cost_telemetry` rollups; refreshed on user-triggered date-range change. No WebSocket / SSE in admin views.
5. **Path aliases**: `@/*` → `src/*` already configured.

## Dependencies

| What I need | From whom | When |
|---|---|---|
| Admin telemetry API endpoints deployed | backend | P4 |
| `cost_telemetry` and `model_call` tables populated | backend | P1+ |
| Cognito `admins` group | devops | P4 |

| What I provide | To whom | When |
|---|---|---|
| Doctor protocol management UI | qa-testing (E2E-7) | P3 end |
| Admin cost/escalations/latency tabs | (PRD owner; pilot ops) | P4 end |

## Testing

- Framework: Vitest + React Testing Library.
- Scope: component rendering, API service mocking, state management, admin gating.
- Test that admin tabs are not rendered for non-admin users.

## Constraints

- React + TypeScript + Vite.
- WCAG AA accessibility.
- No PHI in `console.log` / error reporting.
- Admin endpoints must check Cognito group claim — no client-side-only gating.
- Charting library: Recharts (consistent with v1 vitals charts).
