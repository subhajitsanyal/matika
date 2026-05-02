// Scaffold handler for the Matika v2 bedrock-vision Lambda.
// Real implementation lands in P2 per docs/matika_implementation_plan_v2.md (T-V2-210, T-V2-211).

export interface PhotoExtractRequest {
  sessionId: string;
  patientId: string;
  photoS3Key: string;
  expectedParameter: string;
  expectedUnit: string;
  deviceHint?: string;
  localOcrAttempt?: { rawText: string; confidence: number };
}

export interface PhotoExtractResponse {
  statusCode: number;
  body: string;
}

export async function handler(_event: PhotoExtractRequest): Promise<PhotoExtractResponse> {
  return {
    statusCode: 200,
    body: JSON.stringify({ scaffold: true, version: 'v2.0' }),
  };
}
