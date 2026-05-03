// Confirmed-value → FHIR Observation bridge.
//
// When a /conversation/turn produces an extractedValue with
// status='confirmed', this writer builds a FHIR R4 Observation and
// stores it in S3 at the same key convention as the v1
// sync-observation Lambda:
//   observations/{patientCognitoSub}/{YYYY}/{MM}/{DD}/{observationId}.json
//
// Why direct-write rather than calling sync-observation:
//   - bedrock-router is server-side and has its own VPC + IAM; an
//     API Gateway round-trip to sync-observation would just add
//     latency.
//   - sync-observation's LOINC whitelist doesn't yet include the v2
//     codes 1558-6 (fasting glucose) and 1521-4 (post-meal glucose);
//     bypassing it lets v2 ship without first touching v1 code.
//
// Per-value writes are wrapped in try/catch in the caller so a
// single S3 hiccup doesn't fail the whole turn — the transcript
// still has the data and the bridge can re-run later.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

import type { ExtractedValue } from './parser';

export interface ObservationWriter {
  write(input: ObservationWriteInput): Promise<{ s3Key: string; observationId: string }>;
}

export interface ObservationWriteInput {
  patientCognitoSub: string;     // becomes Patient/{x} in subject.reference
  patientInternalId: string;     // internal UUID; carried in meta for lookups
  sessionId: string;             // session that produced this confirmation
  value: ExtractedValue;
  observedAt: Date;              // when the patient stated the value
}

// Display-name mapping for the FHIR `code.coding[0].display` field.
// Mirrors the table in prompts/system_v2.md.
const DISPLAY_BY_LOINC: Record<string, string> = {
  '8480-6': 'Systolic Blood Pressure',
  '8462-4': 'Diastolic Blood Pressure',
  '2339-0': 'Blood Glucose',
  '1558-6': 'Fasting Blood Glucose',
  '1521-4': 'Post-meal Blood Glucose',
  '8310-5': 'Body Temperature',
  '2708-6': 'Oxygen Saturation',
  '8867-4': 'Heart Rate',
  '29463-7': 'Body Weight',
};

// UCUM unit codes that FHIR's valueQuantity.code expects. We populate
// both `unit` (the human display) and `code` (UCUM machine-readable).
const UCUM_BY_UNIT: Record<string, string> = {
  mmHg: 'mm[Hg]',
  'mg/dL': 'mg/dL',
  '°C': 'Cel',
  '°F': '[degF]',
  '/min': '/min',
  '%': '%',
  kg: 'kg',
};

export class S3ObservationWriter implements ObservationWriter {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly kmsKeyId: string | undefined,
  ) {}

  async write(input: ObservationWriteInput): Promise<{ s3Key: string; observationId: string }> {
    const observationId = `obs-${input.sessionId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
    const observation = buildFhirObservation(input, observationId);

    const yyyy = input.observedAt.getUTCFullYear();
    const mm = String(input.observedAt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(input.observedAt.getUTCDate()).padStart(2, '0');
    const s3Key = `observations/${input.patientCognitoSub}/${yyyy}/${mm}/${dd}/${observationId}.json`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: JSON.stringify(observation, null, 2),
        ContentType: 'application/fhir+json',
        // The bucket's default encryption is SSE-KMS, but specifying
        // explicitly lets us name the key — same pattern as v1
        // sync-observation.
        ServerSideEncryption: 'aws:kms',
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
      }),
    );

    return { s3Key, observationId };
  }
}

// Pure builder — extracted so tests can verify the FHIR shape without
// touching S3. Exported for handler-level integration tests.
export function buildFhirObservation(
  input: ObservationWriteInput,
  observationId: string,
): Record<string, unknown> {
  const v = input.value;
  const display = DISPLAY_BY_LOINC[v.loincCode] ?? v.parameter;
  const ucum = UCUM_BY_UNIT[v.unit] ?? v.unit;

  return {
    resourceType: 'Observation',
    id: observationId,
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs',
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: v.loincCode,
          display,
        },
      ],
    },
    subject: { reference: `Patient/${input.patientCognitoSub}` },
    effectiveDateTime: input.observedAt.toISOString(),
    issued: input.observedAt.toISOString(),
    valueQuantity: {
      value: v.value,
      unit: v.unit,
      system: 'http://unitsofmeasure.org',
      code: ucum,
    },
    meta: {
      lastUpdated: input.observedAt.toISOString(),
      // Trace back to the conversational source so a doctor (or audit)
      // can find the originating session and turn.
      source: `urn:matika:session:${input.sessionId}`,
      // Carry the internal patient UUID in an extension — keeps the
      // canonical FHIR subject.reference stable as the cognito sub
      // (matches v1 convention) while still preserving the FK target.
      tag: [
        {
          system: 'urn:matika:patient-internal-id',
          code: input.patientInternalId,
        },
      ],
    },
  };
}
