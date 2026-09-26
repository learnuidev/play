import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Comment, Content, Favourite, FavouriteEntry, FavouriteTargetType } from '../types';
import { batchGetItems, documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { CONTENTS_TABLE } from './contents';
import { COMMENTS_TABLE } from './comments';
import { env } from './config';

export const FAVOURITES_TABLE = env.favouritesTableName;

/**
 * A favourite's sort key. The type is part of the key rather than a sibling
 * attribute, so content and comment favourites share one key space without ever
 * colliding on an id, and a learner's list comes back grouped by kind.
 */
export function favouriteTargetKey(targetType: FavouriteTargetType, targetId: string): string {
  return `${targetType}#${targetId}`;
}

/** Whether this learner has favourited this target. A single key lookup. */
export async function isFavourited(userId: string, targetKey: string): Promise<boolean> {
  const res = await client.send(
    new GetCommand({ TableName: FAVOURITES_TABLE, Key: { userId, targetKey } }),
  );
  return Boolean(res.Item);
}

/**
 * Records a favourite, and reports whether it was new.
 *
 * The write is conditional on the row not existing, which is what makes
 * favouriting idempotent: a double tap cannot write a second row, and — because
 * the caller only moves the target's counter when this returns `true` — it
 * cannot double-count either. The same condition, inverted, guards removal.
 */
export async function addFavourite(favourite: Favourite): Promise<boolean> {
  try {
    await client.send(
      new PutCommand({
        TableName: FAVOURITES_TABLE,
        Item: favourite,
        ConditionExpression: 'attribute_not_exists(#targetKey)',
        ExpressionAttributeNames: { '#targetKey': 'targetKey' },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false; // already favourited
    throw err;
  }
}

/** Removes a favourite, and reports whether there was one to remove. */
export async function removeFavourite(userId: string, targetKey: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: FAVOURITES_TABLE,
        Key: { userId, targetKey },
        ConditionExpression: 'attribute_exists(#targetKey)',
        ExpressionAttributeNames: { '#targetKey': 'targetKey' },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false; // was not favourited
    throw err;
  }
}

export interface ListFavouritesResult {
  favourites: Favourite[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListFavouritesOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/**
 * Everything a learner has favourited, ordered by the target key — which, since
 * ids are ULIDs, lists each kind in the order its targets were created rather
 * than the order they were favourited in. That is the order a profile reads
 * best in; a strictly chronological list would need a second index for a
 * tie-break nobody has asked for.
 */
export async function listFavourites(
  userId: string,
  opts: ListFavouritesOptions,
): Promise<ListFavouritesResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: FAVOURITES_TABLE,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: true,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  return {
    favourites: (res.Items ?? []) as Favourite[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/**
 * A learner's favourites with what they point at filled in.
 *
 * A favourite is a pointer, so one whose target has since been deleted is
 * skipped rather than reported as broken — the same way a membership of a
 * deleted organization is skipped when listing organizations. It is also why
 * deleting content does not sweep up the favourites aimed at it: they become
 * unreachable on their own.
 */
export async function resolveFavourites(favourites: Favourite[]): Promise<FavouriteEntry[]> {
  const contentIds = favourites
    .filter((f) => f.targetType === 'CONTENT')
    .map((f) => f.targetId);

  const commentKeys = favourites
    .filter((f) => f.targetType === 'COMMENT' && f.contentId)
    .map((f) => ({ contentId: f.contentId as string, commentId: f.targetId }));

  const [contents, comments] = await Promise.all([
    contentIds.length ? batchGetItems<Content>(CONTENTS_TABLE, contentIds.map((contentId) => ({ contentId }))) : [],
    commentKeys.length ? batchGetItems<Comment>(COMMENTS_TABLE, commentKeys) : [],
  ]);

  const contentsById = new Map(contents.map((c) => [c.contentId, c]));
  const commentsById = new Map(comments.map((c) => [`${c.contentId}#${c.commentId}`, c]));

  const entries: FavouriteEntry[] = [];
  for (const favourite of favourites) {
    if (favourite.targetType === 'CONTENT') {
      const content = contentsById.get(favourite.targetId);
      if (!content) continue;
      entries.push({ ...favourite, content });
    } else {
      const comment = commentsById.get(`${favourite.contentId}#${favourite.targetId}`);
      if (!comment) continue;
      entries.push({ ...favourite, comment });
    }
  }

  return entries;
}
