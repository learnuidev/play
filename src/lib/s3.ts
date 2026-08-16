import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './config';

export const s3 = new S3Client({});

export interface PresignUploadParams {
  key: string;
  contentType: string;
  size?: number;
}

export async function createPresignedUploadUrl({ key, contentType, size }: PresignUploadParams): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      ContentType: contentType,
      ...(size !== undefined ? { ContentLength: size } : {}),
    }),
    { expiresIn: 900 },
  );
}

/** Lists all object keys under a prefix (handles pagination). */
export async function listKeysUnderPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

/** Deletes the given object keys (batches of 1000). */
export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: env.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }
}

/** Deletes every object under a prefix (handles pagination, max 1000/batch). */
export async function deletePrefix(prefix: string): Promise<void> {
  const keys = await listKeysUnderPrefix(prefix);
  await deleteObjects(keys);
}

/** Writes a UTF-8 string as an object. */
export async function putObjectText(key: string, text: string, contentType = 'text/plain'): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: text,
      ContentType: contentType,
    }),
  );
}

/** Reads an object body as a UTF-8 string. */
export async function getObjectText(key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
  return (await res.Body?.transformToString()) ?? '';
}
