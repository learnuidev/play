import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ContentFile } from '../types';
import { buildSignedObjectUrl, cloudfrontOrigin } from './cloudfront';
import { env } from './config';
import { documentClient as client } from './dynamodb';
import { createPresignedUploadUrl, deleteObjects, listKeysUnderPrefix } from './s3';

export const CONTENT_FILES_TABLE = env.contentFilesTableName;

/**
 * Content attachments live beside the videos in the one bucket the distribution
 * already serves, under a prefix of their own. Grouping them by the content
 * they belong to means one signed CloudFront policy — scoped to that prefix —
 * covers every file of a piece of content, and deleting the content's
 * attachments is a single prefix delete.
 */
const CONTENT_PREFIX = 'contents';

/** S3 key prefix for every attachment of a piece of content: contents/{contentId}/ */
export function contentFilePrefix(contentId: string): string {
  return `${CONTENT_PREFIX}/${contentId}/`;
}

const MAX_NAME_LENGTH = 120;

/**
 * Turns a client-supplied file name into a key segment: separators and control
 * characters out (a name is a name, not a path), a leading dot-run dropped so
 * nothing looks like a relative path, length capped, and a fallback so an empty
 * one still yields a usable key.
 */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-MAX_NAME_LENGTH)
    .replace(/^[.\-\s]+/, '');
  return cleaned || 'file';
}

/** The key an attachment is stored at: contents/{contentId}/{fileId}/{name} */
export function contentFileKey(contentId: string, fileId: string, name: string): string {
  return `${contentFilePrefix(contentId)}${fileId}/${safeFileName(name)}`;
}

export async function putContentFile(file: ContentFile): Promise<void> {
  await client.send(new PutCommand({ TableName: CONTENT_FILES_TABLE, Item: file }));
}

export async function getContentFile(
  contentId: string,
  fileId: string,
): Promise<ContentFile | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: CONTENT_FILES_TABLE, Key: { contentId, fileId } }),
  );
  return res.Item as ContentFile | undefined;
}

export async function deleteContentFileItem(contentId: string, fileId: string): Promise<void> {
  await client.send(new DeleteCommand({ TableName: CONTENT_FILES_TABLE, Key: { contentId, fileId } }));
}

/** Every attachment of a piece of content, oldest first. */
export async function listContentFiles(contentId: string): Promise<ContentFile[]> {
  const files: ContentFile[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: CONTENT_FILES_TABLE,
        KeyConditionExpression: '#contentId = :contentId',
        ExpressionAttributeNames: { '#contentId': 'contentId' },
        ExpressionAttributeValues: { ':contentId': contentId },
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    files.push(...((res.Items ?? []) as ContentFile[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return files;
}

/** Deletes every file row of a piece of content. */
export async function deleteContentFileItems(contentId: string): Promise<void> {
  const files = await listContentFiles(contentId);
  for (const file of files) {
    await deleteContentFileItem(contentId, file.fileId);
  }
}

/** Deletes every attachment object of a piece of content from S3. */
export async function deleteContentFileObjects(contentId: string): Promise<void> {
  const keys = await listKeysUnderPrefix(contentFilePrefix(contentId));
  if (keys.length) await deleteObjects(keys);
}

/** Removes one attachment's object from S3. */
export async function deleteContentFileObject(key: string): Promise<void> {
  await deleteObjects([key]);
}

export interface ContentFileUpload {
  file: ContentFile;
  upload: {
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
  };
}

/**
 * Reserves an attachment: writes its row and returns a presigned PUT URL for
 * the bytes, which the client sends straight to S3. Only the key passes through
 * the API.
 *
 * The row is written up front rather than confirmed afterwards, the same way a
 * space's cover is, because there is no upload pipeline watching this bucket for
 * attachments. A PUT that never lands leaves a row pointing at a missing
 * object, which the same API can delete.
 */
export async function createContentFileUpload(params: {
  contentId: string;
  fileId: string;
  name: string;
  contentType: string;
  size?: number;
  uploadedBy: string;
}): Promise<ContentFileUpload> {
  const key = contentFileKey(params.contentId, params.fileId, params.name);
  const url = await createPresignedUploadUrl({
    key,
    contentType: params.contentType,
    ...(params.size !== undefined ? { size: params.size } : {}),
  });

  const file: ContentFile = {
    contentId: params.contentId,
    fileId: params.fileId,
    name: params.name,
    key,
    contentType: params.contentType,
    ...(params.size !== undefined ? { size: params.size } : {}),
    uploadedBy: params.uploadedBy,
    createdAt: Date.now(),
  };

  await putContentFile(file);

  return {
    file,
    upload: { url, method: 'PUT', headers: { 'Content-Type': params.contentType } },
  };
}

/** A signed CloudFront URL for one attachment. */
export async function buildContentFileUrl(file: ContentFile): Promise<string> {
  return (await buildSignedObjectUrl(file.key, contentFilePrefix(file.contentId))).url;
}

/**
 * Signs every attachment of a piece of content at once.
 *
 * The policy is scoped to the content's prefix, so the same signature is valid
 * for all of its files — one signature is produced and reused rather than one
 * per file, which keeps a fifty-file content from being fifty RSA signatures.
 */
export async function buildContentFileUrls(files: ContentFile[]): Promise<{
  urls: Map<string, string>;
  expiresAt: number;
}> {
  if (files.length === 0) return { urls: new Map(), expiresAt: 0 };

  const { signedQuery, expiresAt } = await buildSignedObjectUrl(
    files[0].key,
    contentFilePrefix(files[0].contentId),
  );
  const origin = cloudfrontOrigin();

  return {
    urls: new Map(files.map((file) => [file.fileId, `${origin}/${file.key}?${signedQuery}`])),
    expiresAt,
  };
}
