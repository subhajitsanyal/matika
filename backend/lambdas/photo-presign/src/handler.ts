// Photo-presign handler.
//
// Issues a short-lived (5 min) S3 PUT URL the Android/iOS clients can use
// to upload a JPEG of a glucometer / BP cuff display directly to the
// raw-interactions bucket. The client then echoes the s3Key back to
// `/conversation/photo-extract`, which invokes bedrock-vision against it.
//
// Why a dedicated Lambda rather than a route on bedrock-router or
// bedrock-vision: this Lambda only needs `s3:PutObject` (to sign URLs that
// permit PUT to a scoped path). Folding it into either of the conversation
// Lambdas would either grant them PutObject they don't otherwise need
// (bedrock-router) or muddle responsibilities (bedrock-vision processes
// existing photos, doesn't issue uploads). Pre-sign generation is also
// pure local computation — no VPC, no DB, no Bedrock — so cold-start is
// well under 200 ms and there's no point sharing infra with hot-path
// Lambdas.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

export interface PresignRequest {
  patientId: string;
  sessionId: string;
  // Optional override; defaults to image/jpeg. Reject anything that isn't
  // an image MIME type to keep this from being repurposed as a generic
  // upload sink.
  contentType?: string;
}

export interface PresignResponse {
  uploadUrl: string;
  s3Key: string;
  // Headers the client MUST send on the PUT request. Iterate and apply
  // them all blindly. Omitting any of these causes one of two failures:
  //   - HTTP 403 SignatureDoesNotMatch (header was in the signed canonical
  //     request but missing on the wire), OR
  //   - HTTP 403 AccessDenied (bucket policy `EnforceKMSEncryption`
  //     rejects PutObject without `x-amz-server-side-encryption`).
  // Returning the required headers explicitly avoids both failure modes.
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}

export interface HandlerDeps {
  s3: S3Client;
  bucket: string;
  presigner?: typeof getSignedUrl;
  // Date dependency injected for deterministic key generation in tests.
  now?: () => Date;
}

const PRESIGN_TTL_SECONDS = 300; // 5 minutes
const ALLOWED_CONTENT_TYPE_PATTERN = /^image\/(jpe?g|png|heic|webp)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HandlerError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = 'HandlerError';
  }
}

export async function handlePresign(
  event: PresignRequest,
  deps: HandlerDeps,
): Promise<PresignResponse> {
  validateRequest(event);

  const contentType = event.contentType ?? 'image/jpeg';
  if (!ALLOWED_CONTENT_TYPE_PATTERN.test(contentType)) {
    throw new HandlerError(400, 'invalid_content_type', `Unsupported contentType: ${contentType}`);
  }

  const now = (deps.now ?? (() => new Date()))();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const ext = contentTypeToExt(contentType);
  const photoUuid = randomUUID();

  const s3Key = `interactions/${event.patientId}/${yyyy}/${mm}/${dd}/${event.sessionId}/photos/${photoUuid}.${ext}`;

  // The raw-interactions bucket policy `EnforceKMSEncryption` denies any
  // PutObject that doesn't carry `x-amz-server-side-encryption: aws:kms`,
  // so we MUST sign the URL with that header — and the client MUST echo
  // it on the wire. Returning `requiredHeaders` in the response lets the
  // client apply them without having to know about the bucket policy.
  const command = new PutObjectCommand({
    Bucket: deps.bucket,
    Key: s3Key,
    ContentType: contentType,
    ServerSideEncryption: 'aws:kms',
  });

  const presign = deps.presigner ?? getSignedUrl;
  const uploadUrl = await presign(deps.s3, command, { expiresIn: PRESIGN_TTL_SECONDS });

  const requiredHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'x-amz-server-side-encryption': 'aws:kms',
  };

  return { uploadUrl, s3Key, requiredHeaders, expiresIn: PRESIGN_TTL_SECONDS };
}

function validateRequest(event: PresignRequest): void {
  if (!event.patientId || !UUID_PATTERN.test(event.patientId)) {
    throw new HandlerError(400, 'invalid_request', 'patientId is required and must be a UUID');
  }
  if (!event.sessionId || !UUID_PATTERN.test(event.sessionId)) {
    throw new HandlerError(400, 'invalid_request', 'sessionId is required and must be a UUID');
  }
}

function contentTypeToExt(ct: string): string {
  switch (ct.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/heic':
      return 'heic';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}
