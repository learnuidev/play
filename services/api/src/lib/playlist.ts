import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Content, PlaylistEntry, PlaylistItem } from '../types';
import { CONTENTS_TABLE } from './contents';
import { batchGetItems, documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { env } from './config';

export const PLAYLIST_TABLE = env.playlistTableName;

/**
 * Orders a learner's playlist by when they added to it. The base table is keyed
 * by content so "is this in my playlist?" is a single lookup and removing one is
 * a single delete; neither of those can be answered from an `addedAt` key
 * without knowing the timestamp first, which is why the order lives in an index.
 */
const USER_ADDED_INDEX = 'UserAddedIndex';

/** Whether this learner has this content in their playlist. */
export async function isInPlaylist(userId: string, contentId: string): Promise<boolean> {
  const res = await client.send(
    new GetCommand({ TableName: PLAYLIST_TABLE, Key: { userId, contentId } }),
  );
  return Boolean(res.Item);
}

/** Adds content to a learner's playlist, and reports whether it was new. */
export async function addToPlaylist(item: PlaylistItem): Promise<boolean> {
  try {
    await client.send(
      new PutCommand({
        TableName: PLAYLIST_TABLE,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#contentId)',
        ExpressionAttributeNames: { '#contentId': 'contentId' },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false; // already in the playlist
    throw err;
  }
}

/** Removes content from a learner's playlist, and reports whether it was there. */
export async function removeFromPlaylist(userId: string, contentId: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: PLAYLIST_TABLE,
        Key: { userId, contentId },
        ConditionExpression: 'attribute_exists(#contentId)',
        ExpressionAttributeNames: { '#contentId': 'contentId' },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false; // was not in the playlist
    throw err;
  }
}

export interface ListPlaylistResult {
  items: PlaylistItem[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListPlaylistOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/** A learner's playlist, most recently added first. */
export async function listPlaylist(
  userId: string,
  opts: ListPlaylistOptions,
): Promise<ListPlaylistResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: PLAYLIST_TABLE,
      IndexName: USER_ADDED_INDEX,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  return {
    items: (res.Items ?? []) as PlaylistItem[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/**
 * A learner's playlist with the content filled in. Like a favourite, an entry
 * whose content is gone is skipped rather than reported as broken.
 */
export async function resolvePlaylist(items: PlaylistItem[]): Promise<PlaylistEntry[]> {
  if (items.length === 0) return [];

  const contents = await batchGetItems<Content>(
    CONTENTS_TABLE,
    items.map((item) => ({ contentId: item.contentId })),
  );
  const byId = new Map(contents.map((c) => [c.contentId, c]));

  const entries: PlaylistEntry[] = [];
  for (const item of items) {
    const content = byId.get(item.contentId);
    if (!content) continue;
    entries.push({ ...item, content });
  }
  return entries;
}
