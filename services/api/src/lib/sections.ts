import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Section } from '../types';
import { env } from './config';
import { documentClient as client } from './dynamodb';

export const SECTIONS_TABLE = env.sectionsTableName;

/**
 * Orders a space's sections. Position is the range key rather than createdAt
 * because the order a course is read in is a decision the author makes, not a
 * side effect of when they typed it.
 */
const SPACE_POSITION_INDEX = 'SpacePositionIndex';

export async function putSection(section: Section): Promise<void> {
  await client.send(new PutCommand({ TableName: SECTIONS_TABLE, Item: section }));
}

export async function getSection(sectionId: string): Promise<Section | undefined> {
  const res = await client.send(new GetCommand({ TableName: SECTIONS_TABLE, Key: { sectionId } }));
  return res.Item as Section | undefined;
}

export interface UpdateSectionPatch {
  title?: string;
  description?: string;
  position?: number;
}

export async function updateSection(sectionId: string, patch: UpdateSectionPatch): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': Date.now() };
  let set = 'SET updatedAt = :updatedAt';

  for (const field of ['title', 'description', 'position'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    set += `, #${field} = :${field}`;
  }

  await client.send(
    new UpdateCommand({
      TableName: SECTIONS_TABLE,
      Key: { sectionId },
      UpdateExpression: set,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteSectionItem(sectionId: string): Promise<void> {
  await client.send(new DeleteCommand({ TableName: SECTIONS_TABLE, Key: { sectionId } }));
}

export interface ListSectionsResult {
  sections: Section[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListSectionsOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/** A space's sections in reading order. */
export async function listSectionsBySpace(
  spaceId: string,
  opts: ListSectionsOptions,
): Promise<ListSectionsResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: SECTIONS_TABLE,
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
    sections: (res.Items ?? []) as Section[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/**
 * How much of a space's section list an outline request will read. A course is
 * read whole or not at all, so the outline does not paginate — but "whole"
 * still needs a ceiling, and past it the response says it was cut short.
 */
export const MAX_OUTLINE_SECTIONS = 200;

/**
 * Reads every section of a space, following pagination until it is exhausted or
 * `MAX_OUTLINE_SECTIONS` is reached.
 */
export async function listAllSectionsBySpace(
  spaceId: string,
): Promise<{ sections: Section[]; truncated: boolean }> {
  const sections: Section[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const remaining = MAX_OUTLINE_SECTIONS - sections.length;
    const page = await listSectionsBySpace(spaceId, {
      limit: Math.min(remaining, 100),
      exclusiveStartKey,
    });
    sections.push(...page.sections);
    exclusiveStartKey = page.lastEvaluatedKey;
  } while (exclusiveStartKey && sections.length < MAX_OUTLINE_SECTIONS);

  return { sections, truncated: Boolean(exclusiveStartKey) };
}

/**
 * The position a new section should take: one past the last, so sections append
 * to the end of the space without the client having to count them.
 *
 * Reading only the last row (descending, `Limit: 1`) makes this O(1) rather than
 * a scan of the space.
 */
export async function nextSectionPosition(spaceId: string): Promise<number> {
  const res = await client.send(
    new QueryCommand({
      TableName: SECTIONS_TABLE,
      IndexName: SPACE_POSITION_INDEX,
      KeyConditionExpression: '#spaceId = :spaceId',
      ExpressionAttributeNames: { '#spaceId': 'spaceId' },
      ExpressionAttributeValues: { ':spaceId': spaceId },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );

  const last = (res.Items ?? [])[0] as Section | undefined;
  return (last?.position ?? 0) + 1;
}

/**
 * How many sections a space has.
 *
 * A count rather than a list, for the same reason the student count is one: the
 * catalog says "12 lessons in 3 sections" on a card, and shipping every section
 * to the handler to be counted there would be a page of rows for a number.
 */
export async function countSectionsInSpace(spaceId: string): Promise<number> {
  let count = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: SECTIONS_TABLE,
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
