// Voice patient onboarding pivot — invokes the create-patient-from-voice
// Lambda when a caregiver_onboarding session emits complete_session in
// the profile-extraction phase. Owned by backend per AGENTS.md §3.1.
//
// Spec: docs/matika_spec_v2.md §4.5 + §6.9.

import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from '@aws-sdk/client-lambda';
import type { PatientProfile } from './parser';

export interface PatientCredentials {
  email: string;
  phone: string;
}

export interface CreatePatientFromVoiceInput {
  sessionId: string;
  caregiverCognitoSub: string;
  patientProfile: PatientProfile;
  patientCredentials: PatientCredentials;
}

export interface CreatePatientFromVoiceResult {
  patientCognitoSub: string;
  patientShortId: string;
  patientDbId: string;
  inviteSent: boolean;
}

export type CreatePatientFromVoiceFailureKind =
  | 'patient_already_exists'
  | 'cognito_create_failed'
  | 'rds_persist_failed'
  | 'invalid_profile'
  | 'invoke_failed';

export class CreatePatientFromVoiceError extends Error {
  public readonly kind: CreatePatientFromVoiceFailureKind;
  public readonly statusCode: number;

  constructor(kind: CreatePatientFromVoiceFailureKind, statusCode: number, message: string) {
    super(message);
    this.name = 'CreatePatientFromVoiceError';
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

// Tests inject a mock; production uses LambdaPatientFromVoiceCreator.
export interface PatientFromVoiceCreator {
  create(input: CreatePatientFromVoiceInput): Promise<CreatePatientFromVoiceResult>;
}

// Production implementation — direct-invokes the create-patient-from-voice
// Lambda via SDK with the raw payload (NOT wrapped in API Gateway proxy
// shape). The target Lambda's handler reads event.patientProfile etc.
export class LambdaPatientFromVoiceCreator implements PatientFromVoiceCreator {
  constructor(
    private readonly lambdaClient: LambdaClient,
    private readonly functionName: string,
  ) {}

  async create(input: CreatePatientFromVoiceInput): Promise<CreatePatientFromVoiceResult> {
    let response;
    try {
      response = await this.lambdaClient.send(
        new InvokeCommand({
          FunctionName: this.functionName,
          InvocationType: InvocationType.RequestResponse,
          Payload: new TextEncoder().encode(JSON.stringify(input)),
        }),
      );
    } catch (err) {
      throw new CreatePatientFromVoiceError(
        'invoke_failed',
        502,
        `Lambda invoke failed: ${(err as Error).message}`,
      );
    }

    if (!response.Payload) {
      throw new CreatePatientFromVoiceError(
        'invoke_failed',
        502,
        'create-patient-from-voice returned empty payload',
      );
    }

    const decoded = new TextDecoder().decode(response.Payload);
    let parsed: { statusCode?: number; body?: string };
    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new CreatePatientFromVoiceError(
        'invoke_failed',
        502,
        `create-patient-from-voice returned non-JSON payload: ${decoded.slice(0, 200)}`,
      );
    }

    const statusCode = parsed.statusCode ?? 500;
    let body: { error?: string; message?: string; patientCognitoSub?: string; patientShortId?: string; patientDbId?: string; inviteSent?: boolean };
    try {
      body = parsed.body ? JSON.parse(parsed.body) : {};
    } catch {
      body = {};
    }

    if (statusCode === 200) {
      if (!body.patientCognitoSub || !body.patientShortId || !body.patientDbId) {
        throw new CreatePatientFromVoiceError(
          'invoke_failed',
          502,
          'create-patient-from-voice 200 response missing required fields',
        );
      }
      return {
        patientCognitoSub: body.patientCognitoSub,
        patientShortId: body.patientShortId,
        patientDbId: body.patientDbId,
        inviteSent: body.inviteSent ?? false,
      };
    }

    // Error mapping. The Lambda returns specific error codes that the
    // handler can branch on (e.g., 409 patient_already_exists triggers
    // a disambiguation prompt rather than a hard fail).
    const knownKinds: Record<string, CreatePatientFromVoiceFailureKind> = {
      patient_already_exists: 'patient_already_exists',
      cognito_create_failed: 'cognito_create_failed',
      rds_persist_failed: 'rds_persist_failed',
      invalid_profile: 'invalid_profile',
    };
    const kind = (body.error && knownKinds[body.error]) || 'invoke_failed';
    throw new CreatePatientFromVoiceError(
      kind,
      statusCode,
      body.message || body.error || `create-patient-from-voice returned ${statusCode}`,
    );
  }
}
