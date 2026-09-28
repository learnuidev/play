import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Comment, Content, Favourite, FavouriteEntry, FavouriteTargetType } from '../types';
import { batchGetItems, documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { CONTENTS_TABLE } from './contents';
import { COMMENTS_TABLE } from './comments';
import { getLoop } from './loops';
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

/**
 * Which targets of one kind a learner has marked, as a set of ids.
 *
 * Used to draw a list of loops without asking about each one: "which of these
 * have I liked" is one query and a lookup, not one request per row.
 */
export async function listFavouriteTargets(
  userId: string,
  targetType: FavouriteTargetType,
): Promise<Set<string>> {
  const targets = new Set<string>();
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: FAVOURITES_TABLE,
        KeyConditionExpression: '#userId = :userId AND begins_with(#targetKey, :prefix)',
        ExpressionAttributeNames: { '#userId': 'userId', '#targetKey': 'targetKey' },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':prefix': `${targetType}#`,
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    for (const item of (res.Items ?? []) as Favourite[]) targets.add(item.targetId);
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return targets;
}

export interface ListFavouritesResult {
  favourites: Favourite[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListFavouritesOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
  /**
   * Only favourites of this kind.
   *
   * One learner's favourites are one key space ordered by target key, so the
   * whole list arrives grouped: every comment, then every lesson, then every
   * loop. A screen that wants one kind — the marketplace's favourites page
   * wants the lessons — is therefore a `begins_with` on that same key rather
   * than a page read and thrown away, which is the difference between "the
   * videos I hearted" being one query and being however many pages of comment
   * hearts happen to sit in front of them.
   */
  targetType?: FavouriteTargetType;
}

/**
 * Everything a learner has favourited, ordered by the target key — which, since
 * ids are ULIDs, lists each kind in the order its targets were created rather
 * than the order they were favourited in. That is the order a profile reads
 * best in; a strictly chronological list would need a second index for a
 * tie-break nobody has asked for, and a page that would rather show the newest
 * first has the row's own `createdAt` to sort by.
 */
export async function listFavourites(
  userId: string,
  opts: ListFavouritesOptions,
): Promise<ListFavouritesResult> {
  // The kind is part of the sort key, so narrowing to one is a condition on the
  // key rather than a filter applied after the read: DynamoDB's `FilterExpression`
  // would still spend the page size on rows the caller never sees.
  const narrowed = Boolean(opts.targetType);

  const res = await client.send(
    new QueryCommand({
      TableName: FAVOURITES_TABLE,
      KeyConditionExpression: narrowed
        ? '#userId = :userId AND begins_with(#targetKey, :prefix)'
        : '#userId = :userId',
      ExpressionAttributeNames: narrowed
        ? { '#userId': 'userId', '#targetKey': 'targetKey' }
        : { '#userId': 'userId' },
      ExpressionAttributeValues: narrowed
        ? { ':userId': userId, ':prefix': `${opts.targetType}#` }
        : { ':userId': userId },
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
 * Every favourite of one kind a learner has, read to the end.
 *
 * `listFavourites` answers one page, because a screen draws one page; this is for
 * the callers that are asking "what has this person saved" and mean the whole of
 * it — `/v1`'s learning record, which is bounded by a person's own activity.
 * Still a query per page underneath: a `Limit` no pages have, not a scan.
 */
export async function listAllFavourites(
  userId: string,
  targetType?: FavouriteTargetType,
): Promise<Favourite[]> {
  const favourites: Favourite[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await listFavourites(userId, {
      limit: 100,
      targetType,
      ...(exclusiveStartKey ? { exclusiveStartKey } : {}),
    });
    favourites.push(...page.favourites);
    exclusiveStartKey = page.lastEvaluatedKey;
  } while (exclusiveStartKey);

  return favourites;
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

  // A loop is keyed by its owner and its id, so its like records both.
  const loopFavourites = favourites.filter(
    (f) => f.targetType === 'LOOP' && f.contentId && f.targetOwnerId,
  );

  const [contents, comments, loopRows] = await Promise.all([
    contentIds.length ? batchGetItems<Content>(CONTENTS_TABLE, contentIds.map((contentId) => ({ contentId }))) : [],
    commentKeys.length ? batchGetItems<Comment>(COMMENTS_TABLE, commentKeys) : [],
    loopFavourites.length
      ? Promise.all(
          loopFavourites.map((f) =>
            getLoop(f.targetOwnerId as string, f.contentId as string, f.targetId),
          ),
        )
      : Promise.resolve([]),
  ]);

  const contentsById = new Map(contents.map((c) => [c.contentId, c]));
  const commentsById = new Map(comments.map((c) => [`${c.contentId}#${c.commentId}`, c]));
  const loopsById = new Map(
    loopRows.filter(Boolean).map((loop) => [`${loop!.contentId}#${loop!.loopId}`, loop!]),
  );

  const entries: FavouriteEntry[] = [];
  for (const favourite of favourites) {
    if (favourite.targetType === 'CONTENT') {
      const content = contentsById.get(favourite.targetId);
      if (!content) continue;
      entries.push({ ...favourite, content });
      continue;
    }

    if (favourite.targetType === 'COMMENT') {
      const comment = commentsById.get(`${favourite.contentId}#${favourite.targetId}`);
      if (!comment) continue;
      entries.push({ ...favourite, comment });
      continue;
    }

    const loop = loopsById.get(`${favourite.contentId}#${favourite.targetId}`);
    if (!loop) continue;
    entries.push({ ...favourite, loop });
  }

  return entries;
}
