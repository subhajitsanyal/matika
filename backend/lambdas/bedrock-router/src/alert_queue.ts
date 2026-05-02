// Emergency alert queue — enqueues SQS messages that the v1 notification-sender
// Lambda consumes to fire FCM push notifications to the caregiver.
//
// Closes the alert-side of T-V2-222. Owned by backend.
//
// Wire format: a single JSON message with the shape below. notification-sender
// is the consumer; per spec §2.3.3 it'll be updated to recognize these v2
// fields in a follow-up.

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

export type AlertTrigger =
  | 'transcript_keyword' // detectEscalation found an emergency keyword in the patient's words
  | 'llm_classification' // the LLM itself returned escalationReason: "emergency"
  | 'guardrail_block'; // Bedrock Guardrails blocked the response (likely emergency-adjacent)

export interface EmergencyAlertMessage {
  alertType: 'emergency';
  patientId: string;
  sessionId: string;
  triggers: AlertTrigger[]; // can be multiple if several paths fire on the same turn
  transcript: string; // the patient utterance that triggered this
  language: 'en-IN' | 'hi-IN' | 'bn-IN';
  timestamp: string; // ISO-8601
}

export interface RateLimitAlertMessage {
  alertType: 'rate_limit';
  patientId: string;
  callsToday: number;
  hardLimit: number;
  timestamp: string; // ISO-8601
}

export interface AlertEnqueuer {
  enqueueEmergency(message: EmergencyAlertMessage): Promise<void>;
  enqueueRateLimit(message: RateLimitAlertMessage): Promise<void>;
}

export class SqsAlertEnqueuer implements AlertEnqueuer {
  constructor(
    private client: SQSClient,
    private queueUrl: string,
  ) {}

  async enqueueEmergency(message: EmergencyAlertMessage): Promise<void> {
    await this.send(message, message.patientId);
  }

  async enqueueRateLimit(message: RateLimitAlertMessage): Promise<void> {
    await this.send(message, message.patientId);
  }

  private async send(message: object, groupId: string): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        // Group ordering by patient so the consumer processes a single
        // patient's alerts in arrival order (relevant for FIFO queues; for
        // standard queues the attribute is ignored).
        MessageGroupId: groupId,
      }),
    );
  }
}

// Pure function: builds the alert payload from handler-side context. Tests
// assert against this directly without needing an SQS mock.
export interface BuildEmergencyAlertInput {
  patientId: string;
  sessionId: string;
  triggers: AlertTrigger[];
  transcript: string;
  language: 'en-IN' | 'hi-IN' | 'bn-IN';
  now?: () => Date;
}

export function buildEmergencyAlert(input: BuildEmergencyAlertInput): EmergencyAlertMessage {
  if (input.triggers.length === 0) {
    throw new Error('At least one trigger is required for an emergency alert.');
  }
  return {
    alertType: 'emergency',
    patientId: input.patientId,
    sessionId: input.sessionId,
    triggers: input.triggers,
    transcript: input.transcript,
    language: input.language,
    timestamp: (input.now?.() ?? new Date()).toISOString(),
  };
}

export interface BuildRateLimitAlertInput {
  patientId: string;
  callsToday: number;
  hardLimit: number;
  now?: () => Date;
}

export function buildRateLimitAlert(input: BuildRateLimitAlertInput): RateLimitAlertMessage {
  if (input.callsToday < 0) throw new Error('callsToday cannot be negative');
  if (input.hardLimit <= 0) throw new Error('hardLimit must be positive');
  return {
    alertType: 'rate_limit',
    patientId: input.patientId,
    callsToday: input.callsToday,
    hardLimit: input.hardLimit,
    timestamp: (input.now?.() ?? new Date()).toISOString(),
  };
}
