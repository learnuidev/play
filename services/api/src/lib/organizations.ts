import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { OrgMember, OrgMemberStatus, OrgRole, Organization, OrganizationSummary } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';

export const ORGANIZATIONS_TABLE = env.organizationsTableName;
export const ORG_MEMBERS_TABLE = env.orgMembersTableName;

/** GSI on the members table: every organization a user belongs to. */
const USER_ORG_INDEX = 'UserOrgIndex';

/**
 * GSI on the members table: every invitation addressed to one email address.
 *
 * An invitation is keyed by the address it was sent to rather than by a user
 * id, because the person may not have an account yet — which also means the
 * table's own key cannot answer "what has been sent to me?". This index can.
 */
const INVITE_EMAIL_INDEX = 'InviteEmailIndex';

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

export interface ListMembersResult {
  members: OrgMember[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListMembersOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/**
 * The organization's roster, claimed members and unclaimed invitations alike.
 *
 * One query over the organization's partition: a membership is read as a set
 * belonging to the organization rather than by user, which is exactly what the
 * members page asks for. Ordered oldest membership first, so the person who
 * created the organization heads the list.
 */
export async function listMembers(
  orgId: string,
  opts: ListMembersOptions,
): Promise<ListMembersResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: ORG_MEMBERS_TABLE,
      KeyConditionExpression: '#orgId = :orgId',
      ExpressionAttributeNames: { '#orgId': 'orgId' },
      ExpressionAttributeValues: { ':orgId': orgId },
      ScanIndexForward: true,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  return {
    members: (res.Items ?? []) as OrgMember[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/**
 * Every invitation addressed to an email address, across every organization.
 *
 * This is how a signed-in user finds the invitations waiting for them: the
 * address is all the inviter had, so the address is all there is to match on.
 */
export async function listInvitationsForEmail(email: string): Promise<OrgMember[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: ORG_MEMBERS_TABLE,
      IndexName: INVITE_EMAIL_INDEX,
      KeyConditionExpression: '#email = :email',
      ExpressionAttributeNames: { '#email': 'invitedEmail' },
      ExpressionAttributeValues: { ':email': email },
      ScanIndexForward: false,
    }),
  );

  // The index carries every membership row that has the attribute, so the
  // status is filtered here rather than in the key.
  return ((res.Items ?? []) as OrgMember[]).filter((member) => member.status === 'INVITED');
}

export interface InvitationInput {
  orgId: string;
  email: string;
  role: OrgRole;
  /** Cognito `sub` of the user who sent it. */
  invitedBy: string;
}

/**
 * Invites an email address to an organization.
 *
 * The row is keyed by the address, not by a user id: nobody can resolve a `sub`
 * for somebody who has not signed up yet. Accepting the invitation rewrites the
 * row under the real `sub` (see `acceptInvitation`), so an `INVITED` row is the
 * only kind that ever carries an email as its `userId`.
 *
 * Inviting an address that is already invited updates that invitation rather
 * than failing, which is what re-sending one with a different role means.
 */
export async function putInvitation(input: InvitationInput): Promise<OrgMember> {
  const now = Date.now();
  const member: OrgMember = {
    orgId: input.orgId,
    userId: input.email,
    role: input.role,
    status: 'INVITED',
    email: input.email,
    invitedEmail: input.email,
    invitedBy: input.invitedBy,
    joinedAt: now,
  };

  try {
    await client.send(
      new PutCommand({
        TableName: ORG_MEMBERS_TABLE,
        Item: member,
        // Only an invitation that has not been accepted may be replaced, so a
        // re-invite can never quietly rewrite a real membership's role.
        ConditionExpression: 'attribute_not_exists(userId) OR #status = :invited',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':invited': 'INVITED' },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw new AlreadyAMemberError(input.email);
    }
    throw err;
  }

  return member;
}

/** Thrown when an invitation would land on somebody who is already a member. */
export class AlreadyAMemberError extends Error {
  constructor(public readonly email: string) {
    super(`${email} is already a member of this organization`);
    this.name = 'AlreadyAMemberError';
  }
}

/**
 * Moves one membership to a different role.
 *
 * Promoting is free; a change that takes a role *away* from an admin is what
 * the organization's `adminCount` guards, since the last admin leaving would
 * leave an organization nobody can administer. The role move and the counter
 * move go in one transaction, so a demotion is never recorded without the count
 * following it — and a promotion never inflates the count twice.
 *
 * The counter counts *active* admins, so an invitation being given a role does
 * not move it: an invitation is held by nobody, and an organization whose only
 * "admin" never turned up is still an organization nobody can administer.
 */
export async function updateMemberRole(
  orgId: string,
  memberUserId: string,
  role: OrgRole,
  current: { status: OrgMemberStatus; role: OrgRole },
): Promise<void> {
  const becomesAdmin = role === 'ADMIN';
  const wasAdmin = current.status === 'ACTIVE' && current.role === 'ADMIN';
  const counts = current.status === 'ACTIVE';

  const memberUpdate = {
    TableName: ORG_MEMBERS_TABLE,
    Key: { orgId, userId: memberUserId },
    UpdateExpression: 'SET #role = :role',
    ConditionExpression: 'attribute_exists(userId)',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: { ':role': role },
  };

  // Nothing on the admin counter moves: either the role stays on the same side
  // of the admin line, or the membership is an invitation and is not counted at
  // all. A single-item write with nothing to guard.
  if (!counts || wasAdmin === becomesAdmin) {
    await client.send(new UpdateCommand(memberUpdate));
    return;
  }

  // Crossing the line moves the counter too. Losing an admin is the direction
  // that can empty the organization, so the condition lives on the row the
  // counter is on: DynamoDB will not let two concurrent demotions both read the
  // same count and both pass.
  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        { Update: memberUpdate },
        {
          Update: {
            TableName: ORGANIZATIONS_TABLE,
            Key: { orgId },
            UpdateExpression: 'ADD #adminCount :delta SET updatedAt = :now',
            ConditionExpression: becomesAdmin
              ? 'attribute_exists(orgId)'
              : 'attribute_exists(orgId) AND (attribute_not_exists(#adminCount) OR #adminCount > :one)',
            ExpressionAttributeNames: { '#adminCount': 'adminCount' },
            ExpressionAttributeValues: {
              ':delta': becomesAdmin ? 1 : -1,
              ':one': 1,
              ':now': Date.now(),
            },
          },
        },
      ],
    }),
  );
}

/** Thrown when an operation would leave an organization without an admin. */
export class LastAdminError extends Error {
  constructor(message = 'An organization must keep at least one admin') {
    super(message);
    this.name = 'LastAdminError';
  }
}

/**
 * An organization's admin count as the guard reads it, tolerating a row written
 * before the counter existed: such an organization has the one admin that
 * created it.
 */
export function adminCountOf(org: Organization): number {
  return org.adminCount ?? 1;
}

/** Thrown when a membership the caller named is not there. */
export class MemberNotFoundError extends Error {
  constructor(userId: string) {
    super(`No member ${userId} in this organization`);
    this.name = 'MemberNotFoundError';
  }
}

/**
 * Removes a membership: an invitation that was never accepted, or a member
 * being taken off the roster. Both are the same deletion — the row *is* the
 * relationship.
 *
 * Removing an active admin moves the organization's counter down with it,
 * under the same condition an admin demotion uses, so the last admin cannot be
 * removed by any route. Withdrawing an invitation moves nothing: it was never
 * counted.
 */
export async function deleteMember(orgId: string, member: OrgMember): Promise<void> {
  const memberDelete = {
    TableName: ORG_MEMBERS_TABLE,
    Key: { orgId, userId: member.userId },
    ConditionExpression: 'attribute_exists(userId)',
  };

  if (member.status !== 'ACTIVE' || member.role !== 'ADMIN') {
    try {
      await client.send(new DeleteCommand(memberDelete));
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new MemberNotFoundError(member.userId);
      throw err;
    }
    return;
  }

  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: memberDelete },
          {
            Update: {
              TableName: ORGANIZATIONS_TABLE,
              Key: { orgId },
              UpdateExpression: 'ADD #adminCount :delta SET updatedAt = :now',
              ConditionExpression:
                'attribute_exists(orgId) AND (attribute_not_exists(#adminCount) OR #adminCount > :one)',
              ExpressionAttributeNames: { '#adminCount': 'adminCount' },
              ExpressionAttributeValues: { ':delta': -1, ':one': 1, ':now': Date.now() },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new LastAdminError();
    throw err;
  }
}

/** The row an invitation becomes once it is accepted. */
export interface AcceptInvitationInput {
  invitation: OrgMember;
  /** Cognito `sub` of the person accepting it. */
  userId: string;
  /** Address the caller is signed in as, copied onto the accepted row. */
  email?: string;
}

/**
 * Turns an invitation into a membership: the row is re-keyed from the invited
 * address to the real Cognito `sub`, in one transaction so it is never briefly
 * absent — a member who disappeared between two writes would be a member who
 * could not read their own organization.
 *
 * `attribute_not_exists` on the new key is what makes accepting twice, or
 * accepting an invitation to an organization you already belong to, a no-op
 * rather than a role rewrite.
 */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<OrgMember> {
  const { invitation, userId, email } = input;
  const accepted: OrgMember = {
    orgId: invitation.orgId,
    userId,
    role: invitation.role,
    status: 'ACTIVE',
    ...(email ? { email } : {}),
    invitedBy: invitation.invitedBy,
    joinedAt: Date.now(),
  };

  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: ORG_MEMBERS_TABLE, Item: accepted, ConditionExpression: 'attribute_not_exists(userId)' } },
        {
          Delete: {
            TableName: ORG_MEMBERS_TABLE,
            Key: { orgId: invitation.orgId, userId: invitation.userId },
            ConditionExpression: '#status = :invited',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':invited': 'INVITED' },
          },
        },
      ],
    }),
  );

  return accepted;
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

  const memberships = ((res.Items ?? []) as OrgMember[]).filter(
    // An invitation is keyed by an email address, which can land in the same
    // key space as a `sub`, so the status is what says whether this is a
    // relationship or an offer nobody has taken up.
    (membership) => membership.status === 'ACTIVE',
  );
  if (memberships.length === 0) {
    return { organizations: [], lastEvaluatedKey: res.LastEvaluatedKey };
  }

  const byId = await batchGetOrganizationsById(memberships.map((m) => m.orgId));

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
 *
 * Exported because "every organization this id names" is asked by more than the
 * membership listing: an invitation has an organization id and no membership to
 * walk from.
 */
export async function batchGetOrganizationsById(
  orgIds: string[],
): Promise<Map<string, Organization>> {
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
