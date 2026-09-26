import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { OrgMember, Organization, OrganizationSummary } from '../types';
import { env } from './config';
import { documentClient as client } from './dynamodb';

export const ORGANIZATIONS_TABLE = env.organizationsTableName;
export const ORG_MEMBERS_TABLE = env.orgMembersTableName;

/** GSI on the members table: every organization a user belongs to. */
const USER_ORG_INDEX = 'UserOrgIndex';

/**
 * Writes the organization and its first membership (the creator, as `ADMIN`) in
 * a single transaction — an organization can never exist without at least one
 * admin, which is what every later authorization check will lean on.
 */
export async function createOrganization(org: Organization, ownerMember: OrgMember): Promise<void> {
  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: ORGANIZATIONS_TABLE, Item: org } },
        { Put: { TableName: ORG_MEMBERS_TABLE, Item: ownerMember } },
      ],
    }),
  );
}

export async function getOrganization(orgId: string): Promise<Organization | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: ORGANIZATIONS_TABLE, Key: { orgId } }),
  );
  return res.Item as Organization | undefined;
}

export async function getMembership(orgId: string, userId: string): Promise<OrgMember | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: ORG_MEMBERS_TABLE, Key: { orgId, userId } }),
  );
  return res.Item as OrgMember | undefined;
}

export interface ListOrganizationsResult {
  organizations: OrganizationSummary[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListOrganizationsOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/**
 * Lists the organizations a user is a member of, newest membership first.
 *
 * The members table owns the "who belongs to what" relation, so the query runs
 * against it (one row per membership) and the organizations are fetched by key
 * afterwards. Order follows the membership rows because `BatchGetItem` does not
 * preserve key order.
 */
export async function listOrganizationsForUser(
  userId: string,
  opts: ListOrganizationsOptions,
): Promise<ListOrganizationsResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: ORG_MEMBERS_TABLE,
      IndexName: USER_ORG_INDEX,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  const memberships = (res.Items ?? []) as OrgMember[];
  if (memberships.length === 0) {
    return { organizations: [], lastEvaluatedKey: res.LastEvaluatedKey };
  }

  const byId = await batchGetOrganizations(memberships.map((m) => m.orgId));

  const organizations: OrganizationSummary[] = [];
  for (const membership of memberships) {
    const org = byId.get(membership.orgId);
    if (!org) continue; // organization deleted while the membership lingers
    organizations.push({ ...org, role: membership.role });
  }

  return { organizations, lastEvaluatedKey: res.LastEvaluatedKey };
}

const BATCH_GET_ATTEMPTS = 3;
const BATCH_GET_BACKOFF_MS = 50;

/**
 * Fetches organizations by id, retrying the keys DynamoDB reports as
 * unprocessed. `BatchGetItem` can return a partial result under throttling
 * without failing the call, which would otherwise drop organizations from the
 * list silently.
 */
async function batchGetOrganizations(orgIds: string[]): Promise<Map<string, Organization>> {
  const byId = new Map<string, Organization>();
  let keys = orgIds.map((orgId) => ({ orgId }));

  for (let attempt = 0; attempt < BATCH_GET_ATTEMPTS && keys.length > 0; attempt += 1) {
    // Immediate retries would hit the same throttling, so space them out.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, BATCH_GET_BACKOFF_MS * attempt));

    const batch = await client.send(
      new BatchGetCommand({ RequestItems: { [ORGANIZATIONS_TABLE]: { Keys: keys } } }),
    );

    for (const item of (batch.Responses?.[ORGANIZATIONS_TABLE] ?? []) as Organization[]) {
      byId.set(item.orgId, item);
    }

    keys = (batch.UnprocessedKeys?.[ORGANIZATIONS_TABLE]?.Keys ?? []) as Array<{ orgId: string }>;
  }

  return byId;
}

/**
 * Builds a URL-safe slug from a display name and appends a short random suffix,
 * so two organizations with the same name stay addressable without a
 * uniqueness round-trip at creation time.
 */
export function buildSlug(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return base ? `${base}-${suffix}` : `org-${suffix}`;
}
