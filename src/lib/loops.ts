import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ContentLoop } from '../types';
import { env } from './config';
import { documentClient as client } from './dynamodb';

export const CONTENT_LOOPS_TABLE = env.contentLoopsTableName;

/** Shortest loop worth keeping: below this it is a stutter, not a phrase. */
export const MIN_LOOP_MS = 500;

/**
 * A loop's sort key.
 *
 * The content comes first so that a learner's loops live in one partition
 * ordered by the lesson they belong to: "the loops on this one" is then a
 * `begins_with` query rather than a filter over everything they have ever
 * looped. The separator is safe because both ids are ULIDs, which are
 * alphanumeric.
 */
export function loopKey(contentId: string, loopId: string): string {
  return `${contentId}#${loopId}`;
}

const LOOP_PREFIX = (contentId: string) => `${contentId}#`;

export async function putLoop(loop: ContentLoop): Promise<void> {
  await client.send(new PutCommand({ TableName: CONTENT_LOOPS_TABLE, Item: loop }));
}

/**
 * One loop, looked up through its owner.
 *
 * The key is built from the caller's own id, so this can only ever return a loop
 * they made — a loop is addressed by its owner and its lesson together, which is
 * what makes "anyone may read a lesson, but only you may change your loops on
 * it" a property of the key rather than a check somebody has to remember.
 */
export async function getLoop(
  userId: string,
  contentId: string,
  loopId: string,
): Promise<ContentLoop | undefined> {
  const res = await client.send(
    new GetCommand({
      TableName: CONTENT_LOOPS_TABLE,
      Key: { userId, loopKey: loopKey(contentId, loopId) },
    }),
  );
  return res.Item as ContentLoop | undefined;
}

/** A learner's loops on one lesson, oldest first. */
export async function listLoops(userId: string, contentId: string): Promise<ContentLoop[]> {
  const loops: ContentLoop[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: CONTENT_LOOPS_TABLE,
        KeyConditionExpression: '#userId = :userId AND begins_with(#loopKey, :prefix)',
        ExpressionAttributeNames: { '#userId': 'userId', '#loopKey': 'loopKey' },
        ExpressionAttributeValues: { ':userId': userId, ':prefix': LOOP_PREFIX(contentId) },
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    loops.push(...((res.Items ?? []) as ContentLoop[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return loops;
}

export interface UpdateLoopPatch {
  name?: string;
  color?: string;
  startMs?: number;
  endMs?: number;
}

export async function updateLoop(
  userId: string,
  contentId: string,
  loopId: string,
  patch: UpdateLoopPatch,
): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': Date.now() };
  let set = 'SET updatedAt = :updatedAt';

  for (const field of ['name', 'color', 'startMs', 'endMs'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    set += `, #${field} = :${field}`;
  }

  await client.send(
    new UpdateCommand({
      TableName: CONTENT_LOOPS_TABLE,
      Key: { userId, loopKey: loopKey(contentId, loopId) },
      UpdateExpression: set,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteLoopItem(userId: string, contentId: string, loopId: string): Promise<void> {
  await client.send(
    new DeleteCommand({
      TableName: CONTENT_LOOPS_TABLE,
      Key: { userId, loopKey: loopKey(contentId, loopId) },
    }),
  );
}
