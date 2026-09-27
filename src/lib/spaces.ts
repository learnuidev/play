import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Space, SpaceType } from '../types';
import { env } from './config';
import { documentClient as client } from './dynamodb';

export const SPACES_TABLE = env.spacesTableName;

/**
 * Serves both of a space's listing needs from one index: everything an
 * organization owns, newest first. There is deliberately no type index — a type
 * filter is a filter over a page the caller has already fetched, not a separate
 * key space, and the alternative would be a second index to keep in sync.
 */
const ORG_CREATED_INDEX = 'OrganizationCreatedIndex';

export async function putSpace(space: Space): Promise<void> {
  await client.send(new PutCommand({ TableName: SPACES_TABLE, Item: space }));
}

export async function getSpace(spaceId: string): Promise<Space | undefined> {
  const res = await client.send(new GetCommand({ TableName: SPACES_TABLE, Key: { spaceId } }));
  return res.Item as Space | undefined;
}

/**
 * Points a space at its current cover image. The key moves rather than the
 * bytes behind it, so CloudFront serves the new cover immediately instead of
 * holding the old one until its TTL expires.
 */
export async function setSpaceThumbnail(spaceId: string, thumbnailKey: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: SPACES_TABLE,
      Key: { spaceId },
      UpdateExpression: 'SET #thumbnailKey = :thumbnailKey, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#thumbnailKey': 'thumbnailKey' },
      ExpressionAttributeValues: { ':thumbnailKey': thumbnailKey, ':updatedAt': Date.now() },
    }),
  );
}

export interface UpdateSpacePatch {
  title?: string;
  description?: string;
  /** `null` clears the accent colour back to a derived one. */
  color?: string | null;
  type?: SpaceType;
  /** `null` clears the start date, which is what a self-paced course has none of. */
  startAt?: number | null;
  dripIntervalDays?: number | null;
}

/**
 * Changes the course's own details: what it is called, what it says about
 * itself, the colour it wears, and how it runs.
 *
 * A field the caller cleared is removed rather than stored as `null`: "no
 * colour" and "no start date" each have one representation, and it is absence.
 *
 * Changing the type is a real change and is treated as one by the handler: a
 * course that becomes scheduled is given a start date at the same moment, and
 * one that becomes self-paced has its schedule removed — so the row never
 * carries a start date it does not believe in. What it does *not* do is reset
 * anybody's progress: completion is per lesson, and a course that changes how it
 * drips changes what unlocks next, not what has already been read.
 */
export async function updateSpace(spaceId: string, patch: UpdateSpacePatch): Promise<void> {
  let set = 'SET updatedAt = :updatedAt';
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': Date.now() };
  const removes: string[] = [];

  if (patch.title !== undefined) {
    names['#title'] = 'title';
    values[':title'] = patch.title;
    set += ', #title = :title';
  }
  if (patch.description !== undefined) {
    names['#description'] = 'description';
    values[':description'] = patch.description;
    set += ', #description = :description';
  }
  if (patch.type !== undefined) {
    names['#type'] = 'type';
    values[':type'] = patch.type;
    set += ', #type = :type';
  }

  for (const [field, value] of [
    ['color', patch.color],
    ['startAt', patch.startAt],
    ['dripIntervalDays', patch.dripIntervalDays],
  ] as const) {
    if (value === undefined) continue;
    names[`#${field}`] = field;
    if (value === null) removes.push(`#${field}`);
    else {
      values[`:${field}`] = value;
      set += `, #${field} = :${field}`;
    }
  }

  await client.send(
    new UpdateCommand({
      TableName: SPACES_TABLE,
      Key: { spaceId },
      UpdateExpression: removes.length ? `${set} REMOVE ${removes.join(', ')}` : set,
      ConditionExpression: 'attribute_exists(spaceId)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export interface ListSpacesResult {
  spaces: Space[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListSpacesOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/** Spaces belonging to an organization, newest first. */
export async function listSpacesByOrganization(
  organizationId: string,
  opts: ListSpacesOptions,
): Promise<ListSpacesResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: SPACES_TABLE,
      IndexName: ORG_CREATED_INDEX,
      KeyConditionExpression: '#organizationId = :organizationId',
      ExpressionAttributeNames: { '#organizationId': 'organizationId' },
      ExpressionAttributeValues: { ':organizationId': organizationId },
      ScanIndexForward: false,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  return {
    spaces: (res.Items ?? []) as Space[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}
