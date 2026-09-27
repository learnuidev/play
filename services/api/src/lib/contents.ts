import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Content, ContentType } from '../types';
import { deleteContentFileItems, deleteContentFileObjects } from './content-files';
import { deleteCommentItem, listAllComments } from './comments';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';

export const CONTENTS_TABLE = env.contentsTableName;

/** Orders a section's content the way its author arranged it. */
const SECTION_POSITION_INDEX = 'SectionPositionIndex';

/**
 * Orders everything filed under a space, so the space page can fetch an entire
 * outline — every section's content — in one query rather than one per section.
 */
const SPACE_POSITION_INDEX = 'SpacePositionIndex';

/**
 * How much of a space's content an outline request will read. A course is read
 * whole or not at all, so the endpoint does not paginate — but "whole" still
 * needs a ceiling, and beyond it the response says it was cut short.
 */
export const MAX_OUTLINE_CONTENTS = 500;

export async function putContent(content: Content): Promise<void> {
  await client.send(new PutCommand({ TableName: CONTENTS_TABLE, Item: content }));
}

export async function getContent(contentId: string): Promise<Content | undefined> {
  const res = await client.send(new GetCommand({ TableName: CONTENTS_TABLE, Key: { contentId } }));
  return res.Item as Content | undefined;
}

export interface UpdateContentPatch {
  title?: string;
  type?: ContentType;
  /** Pass `null` to unlink the video. */
  videoId?: string | null;
  /** Pass `null` to clear the notes. */
  notes?: Record<string, unknown> | null;
  position?: number;
}

export async function updateContent(contentId: string, patch: UpdateContentPatch): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': Date.now() };
  let set = 'SET updatedAt = :updatedAt';
  let remove = '';

  const assign = (field: string, value: unknown) => {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    set += `, #${field} = :${field}`;
  };

  // Nulls are not a value DynamoDB can store, so they are an explicit REMOVE:
  // that is what unlinking a video or emptying the notes means.
  const assignOrRemove = (field: string, value: unknown | null) => {
    if (value === null) {
      names[`#${field}`] = field;
      remove += `, #${field}`;
      return;
    }
    assign(field, value);
  };

  if (patch.title !== undefined) assign('title', patch.title);
  if (patch.type !== undefined) assign('type', patch.type);
  if (patch.videoId !== undefined) assignOrRemove('videoId', patch.videoId);
  if (patch.notes !== undefined) assignOrRemove('notes', patch.notes);
  if (patch.position !== undefined) assign('position', patch.position);

  const expression = remove ? `${set} REMOVE ${remove.slice(2)}` : set;

  await client.send(
    new UpdateCommand({
      TableName: CONTENTS_TABLE,
      Key: { contentId },
      UpdateExpression: expression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteContentItem(contentId: string): Promise<void> {
  await client.send(new DeleteCommand({ TableName: CONTENTS_TABLE, Key: { contentId } }));
}

/**
 * Removes a piece of content and everything that hangs off it: its attachment
 * rows and objects, and its comments.
 *
 * The content row goes last. If the cascade fails part way, what is left is a
 * content that still exists and can be deleted again, rather than a row of
 * unreachable children pointing at a parent nobody can name.
 *
 * Favourites and playlist entries aimed at it are deliberately *not* swept up:
 * a favourite is a learner's own pointer, and one whose target is gone is
 * skipped when their list is read.
 */
export async function purgeContent(content: Content): Promise<void> {
  const comments = await listAllComments(content.contentId);
  for (const comment of comments) {
    await deleteCommentItem(content.contentId, comment.commentId);
  }

  await deleteContentFileItems(content.contentId);
  await deleteContentFileObjects(content.contentId);
  await deleteContentItem(content.contentId);
}

/** Counters a content row carries. Each delta is added to what is already there. */
export interface ContentCounterDeltas {
  fileCount?: number;
  favouriteCount?: number;
  commentCount?: number;
}

const COUNTER_FIELDS = ['fileCount', 'favouriteCount', 'commentCount'] as const;

/**
 * Moves a content's counters by the given deltas.
 *
 * `ADD` is atomic and treats a missing attribute as zero, so a counter never
 * needs to be initialized and two learners favouriting at the same moment
 * cannot lose one another's increment. `updatedAt` is deliberately untouched: a
 * favourite is not an edit to the content.
 *
 * The write is conditional on the row existing, because `ADD` would otherwise
 * *create* it: a counter moved a moment after the content was deleted would
 * leave behind a row holding nothing but an id and a count. When the condition
 * fails the content is already gone, so there is no counter left to move.
 */
export async function addContentCounters(contentId: string, deltas: ContentCounterDeltas): Promise<void> {
  const names: Record<string, string> = { '#contentId': 'contentId' };
  const values: Record<string, unknown> = {};
  const parts: string[] = [];

  for (const field of COUNTER_FIELDS) {
    const delta = deltas[field];
    if (delta === undefined || delta === 0) continue;
    names[`#${field}`] = field;
    values[`:${field}`] = delta;
    parts.push(`#${field} :${field}`);
  }

  if (parts.length === 0) return;

  try {
    await client.send(
      new UpdateCommand({
        TableName: CONTENTS_TABLE,
        Key: { contentId },
        UpdateExpression: `ADD ${parts.join(', ')}`,
        ConditionExpression: 'attribute_exists(#contentId)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return; // the content is gone; so is its counter
    throw err;
  }
}

export interface ListContentsResult {
  contents: Content[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListContentsOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/** One section's content, in the order it was arranged. */
export async function listContentsBySection(
  sectionId: string,
  opts: ListContentsOptions,
): Promise<ListContentsResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: CONTENTS_TABLE,
      IndexName: SECTION_POSITION_INDEX,
      KeyConditionExpression: '#sectionId = :sectionId',
      ExpressionAttributeNames: { '#sectionId': 'sectionId' },
      ExpressionAttributeValues: { ':sectionId': sectionId },
      ScanIndexForward: true,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  return {
    contents: (res.Items ?? []) as Content[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/**
 * Everything filed under a space, across all its sections, in one page.
 *
 * The space page groups the result by `sectionId` rather than querying each
 * section in turn, which keeps reading an outline at one round trip however
 * many sections it has.
 */
export async function listContentsBySpace(
  spaceId: string,
  opts: ListContentsOptions,
): Promise<ListContentsResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: CONTENTS_TABLE,
      IndexName: SPACE_POSITION_INDEX,
      KeyConditionExpression: '#spaceId = :spaceId',
      ExpressionAttributeNames: { '#spaceId': 'spaceId' },
      ExpressionAttributeValues: { ':spaceId': spaceId },
      ScanIndexForward: true,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  return {
    contents: (res.Items ?? []) as Content[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/**
 * Reads a space's whole outline, following pagination until it is exhausted or
 * `MAX_OUTLINE_CONTENTS` is reached.
 */
export async function listAllContentsBySpace(
  spaceId: string,
): Promise<{ contents: Content[]; truncated: boolean }> {
  const contents: Content[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const remaining = MAX_OUTLINE_CONTENTS - contents.length;
    const page = await listContentsBySpace(spaceId, {
      limit: Math.min(remaining, 100),
      exclusiveStartKey,
    });
    contents.push(...page.contents);
    exclusiveStartKey = page.lastEvaluatedKey;
  } while (exclusiveStartKey && contents.length < MAX_OUTLINE_CONTENTS);

  return { contents, truncated: Boolean(exclusiveStartKey) };
}

/**
 * Reads every piece of content in a section, following pagination until it is
 * exhausted. Used by the cascades that empty a section or a space, where
 * stopping at a page boundary would leave orphans behind.
 */
export async function listAllContentsBySection(sectionId: string): Promise<Content[]> {
  const contents: Content[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await listContentsBySection(sectionId, { limit: 100, exclusiveStartKey });
    contents.push(...page.contents);
    exclusiveStartKey = page.lastEvaluatedKey;
  } while (exclusiveStartKey);

  return contents;
}

/**
 * The position a new piece of content should take: one past the last in its
 * section. Reading only the last row keeps this O(1) instead of a count.
 */
export async function nextContentPosition(sectionId: string): Promise<number> {
  const res = await client.send(
    new QueryCommand({
      TableName: CONTENTS_TABLE,
      IndexName: SECTION_POSITION_INDEX,
      KeyConditionExpression: '#sectionId = :sectionId',
      ExpressionAttributeNames: { '#sectionId': 'sectionId' },
      ExpressionAttributeValues: { ':sectionId': sectionId },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );

  const last = (res.Items ?? [])[0] as Content | undefined;
  return (last?.position ?? 0) + 1;
}

/**
 * How many lessons a space holds.
 *
 * One `COUNT` query over the space's own index — the same one the whole outline
 * is read from — so a course can say how long it is on a card without reading
 * every lesson of it to find out.
 */
export async function countContentsInSpace(spaceId: string): Promise<number> {
  let count = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: CONTENTS_TABLE,
        IndexName: SPACE_POSITION_INDEX,
        KeyConditionExpression: '#spaceId = :spaceId',
        ExpressionAttributeNames: { '#spaceId': 'spaceId' },
        ExpressionAttributeValues: { ':spaceId': spaceId },
        Select: 'COUNT',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    count += res.Count ?? 0;
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return count;
}
