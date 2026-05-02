// Loads photo bytes from S3 for vision Bedrock invocation.
//
// The Android app uploads the photo via presigned URL to
// `s3://{raw-bucket}/interactions/{patientId}/{YYYY}/{MM}/{DD}/{sessionId}/photos/uuid.jpg`
// before calling /conversation/photo-extract. We read those bytes and pass
// them as base64 in the Bedrock vision request.

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

export interface PhotoLoader {
  load(s3Key: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
}

export class S3PhotoLoader implements PhotoLoader {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}

  async load(s3Key: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );
    if (!response.Body) {
      throw new Error(`S3 object had no body: ${s3Key}`);
    }
    const bytes = await streamToBytes(response.Body as { transformToByteArray: () => Promise<Uint8Array> });
    const mediaType = response.ContentType ?? guessMediaType(s3Key);
    return { bytes, mediaType };
  }
}

async function streamToBytes(
  body: { transformToByteArray: () => Promise<Uint8Array> },
): Promise<Uint8Array> {
  // The AWS SDK v3 S3 response body has a transformToByteArray() helper.
  return body.transformToByteArray();
}

function guessMediaType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
