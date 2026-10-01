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

/**
 * GSI on the spaces table: every course the marketplace lists, newest first.
 *
 * Keyed by a constant that only a listed course carries rather than by the
 * `listed` flag itself, because a boolean cannot be a partition key and a filter
 * over every space in the table would be a scan wearing a query's clothes. A
 * course that leaves the catalog loses the attribute, and with it its place in
 * the index.
 */
const CATALOG_CREATED_INDEX = 'CatalogCreatedIndex';

/** The one value `catalogKey` ever holds. */
const CATALOG_KEY = 'LISTED';

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
  /** Whether the course appears in the marketplace catalog. */
  listed?: boolean;
  /**
   * What the course costs, in the smallest unit of `currency`.
   *
   * `null` makes it free again, which is the same representation as never having
   * priced it — see `Space.priceCents`. A whole number of cents, checked by the
   * handler that reads the request: a price arrived at by rounding a decimal is a
   * price that will eventually be wrong by a cent, and Stripe's own API takes the
   * smallest unit for that reason.
   */
  priceCents?: number | null;
  /** `usd`, lower case as Stripe spells it. `null` falls back to `usd`. */
  currency?: string | null;
  /** The Stripe price object this course is sold at. `null` clears it. */
  stripePriceId?: string | null;
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

  // Listing a course writes the index's own key beside the flag, and unlisting
  // removes both: the index holds courses, not flags, so "not listed" is being
  // absent from it rather than being present and marked false.
  if (patch.listed !== undefined) {
    names['#listed'] = 'listed';
    names['#catalogKey'] = 'catalogKey';
    if (patch.listed) {
      values[':listed'] = true;
      values[':catalogKey'] = CATALOG_KEY;
      set += ', #listed = :listed, #catalogKey = :catalogKey';
    } else {
      removes.push('#listed', '#catalogKey');
    }
  }

  for (const [field, value] of [
    ['color', patch.color],
    ['startAt', patch.startAt],
    ['dripIntervalDays', patch.dripIntervalDays],
    // The price falls in the same group as the colour, and for the same reason:
    // clearing it is a *removal* rather than a zero, so a course that goes from
    // paid to free stops carrying a price instead of carrying `0`. The two are
    // the same to the enrollment check — see `Space.priceCents` — but only one of
    // them reads as "this course is free" in the table.
    ['priceCents', patch.priceCents],
    ['currency', patch.currency],
    ['stripePriceId', patch.stripePriceId],
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

/**
 * Courses the marketplace lists, newest first.
 *
 * One query, not a scan: everything in this index is a listed course, so the
 * catalog's page is exactly what DynamoDB hands back and no filtering happens
 * on this side.
 */
export async function listListedSpaces(opts: ListSpacesOptions): Promise<ListSpacesResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: SPACES_TABLE,
      IndexName: CATALOG_CREATED_INDEX,
      KeyConditionExpression: '#catalogKey = :catalogKey',
      ExpressionAttributeNames: { '#catalogKey': 'catalogKey' },
      ExpressionAttributeValues: { ':catalogKey': CATALOG_KEY },
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
