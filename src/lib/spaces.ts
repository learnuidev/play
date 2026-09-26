import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Space } from '../types';
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
