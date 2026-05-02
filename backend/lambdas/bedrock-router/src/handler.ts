// Scaffold handler for the Matika v2 bedrock-router Lambda.
// Real implementation lands in P1 per docs/matika_implementation_plan_v2.md (T-V2-100..T-V2-111).

export interface TurnRequest {
  sessionId: string;
  patientId: string;
  transcript: string;
  language: string;
  turnSequence: number;
}

export interface TurnResponse {
  statusCode: number;
  body: string;
}

export async function handler(_event: TurnRequest): Promise<TurnResponse> {
  return {
    statusCode: 200,
    body: JSON.stringify({ scaffold: true, version: 'v2.0' }),
  };
}
