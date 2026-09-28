import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { LessonCompletion } from '../types';
import { env } from './config';
import { documentClient as client } from './dynamodb';

export const COMPLETIONS_TABLE = env.completionsTableName;

/**
 * A completion's sort key.
 *
 * The course comes first so a learner's finished lessons live in one partition
 * ordered by the course they belong to: "what have I done in this space" is a
 * `begins_with` query, and "have I done this lesson" is a single lookup built
 * from the same two ids. Both ids are ULIDs, so the separator is unambiguous.
 */
export function completionKey(spaceId: string, contentId: string): string {
  return `${spaceId}#${contentId}`;
}

export async function putCompletion(completion: LessonCompletion): Promise<void> {
  await client.send(new PutCommand({ TableName: COMPLETIONS_TABLE, Item: completion }));
}

export async function getCompletion(
  userId: string,
  spaceId: string,
  contentId: string,
): Promise<LessonCompletion | undefined> {
  const res = await client.send(
    new GetCommand({
      TableName: COMPLETIONS_TABLE,
      Key: { userId, spaceKey: completionKey(spaceId, contentId) },
    }),
  );
  return res.Item as LessonCompletion | undefined;
}

export async function deleteCompletion(
  userId: string,
  spaceId: string,
  contentId: string,
): Promise<void> {
  await client.send(
    new DeleteCommand({
      TableName: COMPLETIONS_TABLE,
      Key: { userId, spaceKey: completionKey(spaceId, contentId) },
    }),
  );
}

/**
 * Every lesson this learner has finished, everywhere.
 *
 * Paged to the end rather than answering with one page: this is somebody's own
 * record, bounded by what they have done rather than by what the service holds,
 * and a caller that has to page through its own history is a caller being told
 * about an index it should not have to know about. The same reasoning as
 * `listTokensForGrant` — and the same rule about `LastEvaluatedKey`, which a
 * query returns instead of an error when it has stopped early.
 */
export async function listCompletionsForUser(userId: string): Promise<LessonCompletion[]> {
  const completions: LessonCompletion[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: COMPLETIONS_TABLE,
        KeyConditionExpression: '#userId = :userId',
        ExpressionAttributeNames: { '#userId': 'userId' },
        ExpressionAttributeValues: { ':userId': userId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    completions.push(...((res.Items ?? []) as LessonCompletion[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return completions;
}

/** Every lesson this learner has finished in a course. */
export async function listCompletionsInSpace(
  userId: string,
  spaceId: string,
): Promise<LessonCompletion[]> {
  const completions: LessonCompletion[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: COMPLETIONS_TABLE,
        KeyConditionExpression: '#userId = :userId AND begins_with(#spaceKey, :prefix)',
        ExpressionAttributeNames: { '#userId': 'userId', '#spaceKey': 'spaceKey' },
        ExpressionAttributeValues: { ':userId': userId, ':prefix': `${spaceId}#` },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    completions.push(...((res.Items ?? []) as LessonCompletion[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return completions;
}
