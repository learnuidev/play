import { createHash, randomBytes } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { ApiKey, ApiKeyRecord, OrganizationApiKey } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { HttpError } from './http';

export const API_KEYS_TABLE = env.apiKeysTableName;

/** GSI on the keys table: every key one person holds. */
const USER_CREATED_INDEX = 'UserCreatedIndex';

/**
 * GSI on the keys table: every key made for one organization.
 *
 * Sparse — only a key whose creator named an organization carries the attribute
 * — so this index holds the organization's keys and nothing else, and it is what
 * an admin's list reads. An admin sees the keys of the organization rather than
 * those of its members one member at a time: a key made by somebody who has
 * since left the organization still belongs to it.
 */
const ORGANIZATION_CREATED_INDEX = 'OrganizationCreatedIndex';

/**
 * GSI on the keys table: the hash a presented secret is looked up by.
 *
 * The authorizer has the secret and nothing else — no id, no owner — so the
 * hash has to be a key space of its own, and an entry leaves it exactly when the
 * key behind it is deleted. It is a separate index rather than the
 * table's own key so that a row stays addressable by `keyId` for everything the
 * studio does: listing, revoking and attributing a key all read it by id, and a
 * table keyed by hash could answer none of those without a second index.
 */
const KEY_HASH_INDEX = 'KeyHashIndex';

/**
 * What every key starts with.
 *
 * A prefix rather than an opaque string for the same reason secret-scanning
 * exists: `play_sk_` in a log, a paste or a commit is recognizable as ours, and
 * a leaked key can be found by grepping for it.
 */
const KEY_PREFIX = 'play_sk_';

/**
 * How much of the secret is kept in the clear, to tell two keys apart in a list.
 *
 * Eight characters of a 32-character random body: enough that two keys for one
 * account are distinguishable at a glance, and far too little to be worth
 * attacking — the remaining 24 characters are what has to be guessed.
 */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 8;

/**
 * How many unused keys one person may hold at once.
 *
 * A limit rather than a quota: nothing here is metered, and the reason to have
 * one at all is that an unbounded list of keys is an unbounded list of things
 * that can be lost. Twenty-five is more than anybody rotates through by hand.
 */
const MAX_ACTIVE_KEYS_PER_USER = 25;

/**
 * How stale `lastUsedAt` may be before a request bothers to write it.
 *
 * Authenticating a key is a read; recording that it was used is a write. Doing
 * that write on every request would put a DynamoDB write in front of every call
 * a customer makes, to keep a timestamp nobody reads to the second. Conditional
 * on the stored value, so the write happens about once per key per window and
 * every request between them is read-only.
 */
const LAST_USED_REFRESH_MS = 5 * 60 * 1000;

/**
 * A fresh secret: `play_sk_` and 24 bytes of randomness.
 *
 * `randomBytes` rather than anything derived from the key's id, owner or name,
 * because everything else about a key is public and a secret that is derivable
 * from public things is not one. 24 bytes is 192 bits — well past the point
 * where guessing is the cheapest way in, and short enough to paste.
 */
export function generateApiKeySecret(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}

/**
 * The stored representation of a secret: hex SHA-256.
 *
 * A plain hash rather than a salted password hash, deliberately. A password is
 * short, guessable and reused, so it needs a slow hash and a salt; this is 192
 * bits of machine-generated randomness that exists in exactly one place, where
 * the only attack that matters is a precomputed table — which a salt defeats and
 * which a 192-bit secret defeats on its own. What a plain hash buys is the
 * lookup: the authorizer verifies by reading one item by key, not by scanning
 * every key and testing each.
 */
export function hashApiKeySecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** The part of a secret a list may show. */
export function apiKeyPrefixOf(secret: string): string {
  return secret.slice(0, DISPLAY_PREFIX_LENGTH);
}

/** The row as its owner's app reads it: no hash, and no owner. */
export function toApiKey(record: ApiKeyRecord): ApiKey {
  return {
    keyId: record.keyId,
    name: record.name,
    prefix: record.prefix,
    createdAt: record.createdAt,
    ...(record.lastUsedAt !== undefined ? { lastUsedAt: record.lastUsedAt } : {}),
    ...(record.organizationId ? { organizationId: record.organizationId } : {}),
    ...(record.organizationName ? { organizationName: record.organizationName } : {}),
  };
}

/** The row as an organization's admin reads it: the key, and who made it. */
export function toOrganizationApiKey(record: ApiKeyRecord): OrganizationApiKey {
  return {
    ...toApiKey(record),
    userId: record.userId,
    ...(record.userEmail ? { userEmail: record.userEmail } : {}),
  };
}

export interface CreateApiKeyInput {
  /** Cognito `sub` of the person making it. */
  userId: string;
  userEmail?: string;
  name: string;
  organizationId?: string;
  organizationName?: string;
}

/**
 * Makes a key and stores the hash of it.
 *
 * The secret is returned and never kept: everything after this reads the row by
 * id or by hash, and nothing anywhere can reproduce the secret.
 */
export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<{ record: ApiKeyRecord; secret: string }> {
  const secret = generateApiKeySecret();
  const now = Date.now();

  const record: ApiKeyRecord = {
    keyId: ulid(),
    name: input.name,
    prefix: apiKeyPrefixOf(secret),
    keyHash: hashApiKeySecret(secret),
    userId: input.userId,
    ...(input.userEmail ? { userEmail: input.userEmail } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.organizationName ? { organizationName: input.organizationName } : {}),
    createdAt: now,
  };

  await client.send(new PutCommand({ TableName: API_KEYS_TABLE, Item: record }));

  return { record, secret };
}

/**
 * Refuses to make a key when the caller already holds the maximum.
 *
 * Counted over the caller's own index rather than a counter on a row, because a
 * counter is a number that drifts and this one is read once per creation.
 *
 * Every row in this index is a key somebody can use, because revoking deletes
 * one rather than marking it: there is nothing here to filter out, and the count
 * is the whole of what the caller holds.
 */
export async function assertKeyAllowance(userId: string): Promise<void> {
  const { keys } = await listApiKeysForUser(userId, { limit: MAX_ACTIVE_KEYS_PER_USER });

  if (keys.length >= MAX_ACTIVE_KEYS_PER_USER) {
    throw new HttpError(
      409,
      `You already hold ${MAX_ACTIVE_KEYS_PER_USER} active keys. Revoke one before making another.`,
    );
  }
}

export async function getApiKey(keyId: string): Promise<ApiKeyRecord | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: API_KEYS_TABLE, Key: { keyId } }),
  );
  return res.Item as ApiKeyRecord | undefined;
}

export interface ListApiKeysResult {
  keys: ApiKeyRecord[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListApiKeysOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/** Keys through one of the table's indexes, newest first. */
async function listKeysByIndex(
  indexName: string,
  keyName: 'userId' | 'organizationId',
  keyValue: string,
  opts: ListApiKeysOptions,
): Promise<ListApiKeysResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: API_KEYS_TABLE,
      IndexName: indexName,
      KeyConditionExpression: '#key = :key',
      ExpressionAttributeNames: { '#key': keyName },
      ExpressionAttributeValues: { ':key': keyValue },
      ScanIndexForward: false,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  return {
    keys: (res.Items ?? []) as ApiKeyRecord[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/** The keys one person holds, newest first. */
export function listApiKeysForUser(
  userId: string,
  opts: ListApiKeysOptions,
): Promise<ListApiKeysResult> {
  return listKeysByIndex(USER_CREATED_INDEX, 'userId', userId, opts);
}

/** The keys one organization holds, whoever made them, newest first. */
export function listApiKeysForOrganization(
  organizationId: string,
  opts: ListApiKeysOptions,
): Promise<ListApiKeysResult> {
  return listKeysByIndex(ORGANIZATION_CREATED_INDEX, 'organizationId', organizationId, opts);
}

/**
 * The key a presented secret belongs to, or nothing.
 *
 * Read through the hash index, so an unknown secret is one query that returns
 * nothing rather than a walk through every key ever made. A revoked key is
 * unknown by the same route: revoking deletes the row, and the index entry goes
 * with it.
 */
export async function findApiKeyBySecret(secret: string): Promise<ApiKeyRecord | undefined> {
  const res = await client.send(
    new QueryCommand({
      TableName: API_KEYS_TABLE,
      IndexName: KEY_HASH_INDEX,
      KeyConditionExpression: '#keyHash = :keyHash',
      ExpressionAttributeNames: { '#keyHash': 'keyHash' },
      ExpressionAttributeValues: { ':keyHash': hashApiKeySecret(secret) },
      Limit: 1,
    }),
  );

  return ((res.Items ?? []) as ApiKeyRecord[])[0];
}

/**
 * Records that a key was just used, at most once per refresh window.
 *
 * Conditional on the timestamp being absent or older than the window, so the
 * common case — the twentieth call in a minute — writes nothing and the failure
 * of that condition is the expected outcome rather than an error.
 */
export async function touchApiKey(keyId: string): Promise<void> {
  try {
    await client.send(
      new UpdateCommand({
        TableName: API_KEYS_TABLE,
        Key: { keyId },
        UpdateExpression: 'SET lastUsedAt = :now',
        ConditionExpression:
          'attribute_not_exists(lastUsedAt) OR lastUsedAt < :staleBefore',
        ExpressionAttributeValues: {
          ':now': Date.now(),
          ':staleBefore': Date.now() - LAST_USED_REFRESH_MS,
        },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return;
    // A key that authenticated is a key that authenticated: failing the request
    // because a usage timestamp could not be written would be the tail wagging
    // the dog.
    console.error('Could not record API key use', err);
  }
}

/**
 * Deletes a key, and says whether there was one to delete.
 *
 * A hard delete rather than a tombstone. The row is the credential and nothing
 * else — the hash, the name, who made it and when it was last used — and every
 * one of those is a fact about a key that exists. Keeping the row after the key
 * stops working means keeping a credential's record for no purpose but the
 * record, and this API has no answer to give about a key that is gone.
 *
 * Conditional on the row still being there, so that a delete racing another
 * delete reports one success and one absence rather than two.
 */
export async function revokeApiKey(keyId: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: API_KEYS_TABLE,
        Key: { keyId },
        ConditionExpression: 'attribute_exists(keyId)',
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
}
