import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { SpaceMember, SpaceMemberRole } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { sendSpaceInvitationEmail } from './mail';
import type { AuthUser } from './auth';
import type { MailDelivery } from './members';

export const SPACE_MEMBERS_TABLE = env.spaceMembersTableName;

/**
 * GSI on the members table: every course one person is in.
 *
 * The mirror of the organization roster's `UserOrgIndex`, and what makes "what
 * am I taking?" one query rather than a scan of every course.
 */
const USER_SPACE_INDEX = 'UserSpaceIndex';

/**
 * GSI on the members table: every invitation addressed to one email address.
 *
 * An outstanding invitation is keyed by the address it was sent to — there is no
 * `sub` to key it by until somebody claims it — so the table's own key cannot
 * answer "what has been sent to me?". This index can.
 */
const INVITE_EMAIL_INDEX = 'InviteEmailIndex';

export async function getSpaceMember(
  spaceId: string,
  userId: string,
): Promise<SpaceMember | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: SPACE_MEMBERS_TABLE, Key: { spaceId, userId } }),
  );
  return res.Item as SpaceMember | undefined;
}

/**
 * Whether this person is actually in the course.
 *
 * Only an `ACTIVE` row is a membership: an invitation is an offer addressed to
 * an email address, and treating it as access would let a course be read by
 * whoever happens to know which address was invited.
 */
export async function isSpaceMember(spaceId: string, userId: string): Promise<boolean> {
  const member = await getSpaceMember(spaceId, userId);
  return member?.status === 'ACTIVE';
}

export interface ListSpaceMembersResult {
  members: SpaceMember[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListSpaceMembersOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/**
 * A course's roster, in the order people were added.
 *
 * One query over the course's own partition — which is the whole reason
 * membership is keyed by the course rather than stored on the space: a cohort
 * of two hundred is a page of one partition, not a number that outgrew an item.
 */
export async function listSpaceMembers(
  spaceId: string,
  opts: ListSpaceMembersOptions,
): Promise<ListSpaceMembersResult> {
  const res = await client.send(
    new QueryCommand({
      TableName: SPACE_MEMBERS_TABLE,
      KeyConditionExpression: '#spaceId = :spaceId',
      ExpressionAttributeNames: { '#spaceId': 'spaceId' },
      ExpressionAttributeValues: { ':spaceId': spaceId },
      ScanIndexForward: true,
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
    }),
  );

  return {
    members: (res.Items ?? []) as SpaceMember[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/** Every course this person is in, most recently joined first. */
export async function listSpaceMembershipsForUser(userId: string): Promise<SpaceMember[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: SPACE_MEMBERS_TABLE,
      IndexName: USER_SPACE_INDEX,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
    }),
  );

  return ((res.Items ?? []) as SpaceMember[]).filter((member) => member.status === 'ACTIVE');
}

/**
 * How many students a course has.
 *
 * A count rather than a list: the overview asks for a number, and DynamoDB can
 * answer with the number alone instead of shipping every row to be counted here.
 * Assistants and instructors are not students, so the role is part of the query.
 */
export async function countSpaceStudents(spaceId: string): Promise<number> {
  let count = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: SPACE_MEMBERS_TABLE,
        KeyConditionExpression: '#spaceId = :spaceId',
        FilterExpression: '#status = :active AND #role = :student',
        ExpressionAttributeNames: {
          '#spaceId': 'spaceId',
          '#status': 'status',
          '#role': 'role',
        },
        ExpressionAttributeValues: { ':spaceId': spaceId, ':active': 'ACTIVE', ':student': 'STUDENT' },
        Select: 'COUNT',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    count += res.Count ?? 0;
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return count;
}

/**
 * Every active instructor of a course, in the order they were added.
 *
 * A query of the course's own partition with the role and status filtered in
 * DynamoDB rather than here, because the answer is a handful of rows out of a
 * roster that may be hundreds: a course's students are the page, and its
 * instructors are the line above it. Paged to the end for the same reason the
 * student count is counted to the end — an instructor on page two is still an
 * instructor.
 */
export async function listActiveInstructors(spaceId: string): Promise<SpaceMember[]> {
  const instructors: SpaceMember[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: SPACE_MEMBERS_TABLE,
        KeyConditionExpression: '#spaceId = :spaceId',
        FilterExpression: '#status = :active AND #role = :instructor',
        ExpressionAttributeNames: {
          '#spaceId': 'spaceId',
          '#status': 'status',
          '#role': 'role',
        },
        ExpressionAttributeValues: {
          ':spaceId': spaceId,
          ':active': 'ACTIVE',
          ':instructor': 'INSTRUCTOR',
        },
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    instructors.push(...((res.Items ?? []) as SpaceMember[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return instructors;
}

export interface SpaceInvitationInput {
  spaceId: string;
  organizationId: string;
  /** The address the offer is made to, already normalized. */
  email: string;
  role: SpaceMemberRole;
  /** Cognito `sub` of the user who sent it. */
  invitedBy: string;
}

/**
 * Invites an email address to a course.
 *
 * Keyed by the address, not by a user id, for the same reason the organization
 * roster is: nobody can resolve a `sub` for somebody who has not signed up, and
 * a course is exactly the kind of thing offered to people outside the building.
 * Accepting rewrites the row under the real `sub`.
 *
 * Inviting an address that is already invited replaces that invitation, which is
 * what re-sending one with a different role means. It can never replace a real
 * membership: the condition allows the write only when the row is absent or
 * still an invitation.
 */
export async function putSpaceInvitation(input: SpaceInvitationInput): Promise<SpaceMember> {
  const now = Date.now();
  const member: SpaceMember = {
    spaceId: input.spaceId,
    userId: input.email,
    organizationId: input.organizationId,
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
        TableName: SPACE_MEMBERS_TABLE,
        Item: member,
        ConditionExpression: 'attribute_not_exists(userId) OR #status = :invited',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':invited': 'INVITED' },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new AlreadyInSpaceError(input.email);
    throw err;
  }

  return member;
}

/** Thrown when an invitation would land on somebody who is already in the course. */
export class AlreadyInSpaceError extends Error {
  constructor(public readonly email: string) {
    super(`${email} is already a member of this course`);
    this.name = 'AlreadyInSpaceError';
  }
}

/** Moves one membership to a different role. */
export async function updateSpaceMemberRole(
  spaceId: string,
  userId: string,
  role: SpaceMemberRole,
): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: SPACE_MEMBERS_TABLE,
      Key: { spaceId, userId },
      UpdateExpression: 'SET #role = :role',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':role': role },
    }),
  );
}

/** Thrown when a membership the caller named is not there. */
export class SpaceMemberNotFoundError extends Error {
  constructor(userId: string) {
    super(`No member ${userId} in this course`);
    this.name = 'SpaceMemberNotFoundError';
  }
}

/**
 * Removes a membership: an invitation nobody accepted, or a member being taken
 * off the roster. Both are the same deletion — the row *is* the relationship.
 */
export async function deleteSpaceMember(spaceId: string, userId: string): Promise<void> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: SPACE_MEMBERS_TABLE,
        Key: { spaceId, userId },
        ConditionExpression: 'attribute_exists(userId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new SpaceMemberNotFoundError(userId);
    throw err;
  }
}

/**
 * Turns an invitation into a membership: the row is re-keyed from the invited
 * address to the real Cognito `sub`, in one transaction so the member is never
 * briefly absent, and with `attribute_not_exists` on the new key so accepting an
 * invitation you already hold is a no-op rather than a role rewrite.
 */
export async function acceptSpaceInvitation(input: {
  invitation: SpaceMember;
  userId: string;
  email?: string;
}): Promise<SpaceMember> {
  const { invitation, userId, email } = input;
  const accepted: SpaceMember = {
    spaceId: invitation.spaceId,
    userId,
    organizationId: invitation.organizationId,
    role: invitation.role,
    status: 'ACTIVE',
    ...(email ? { email } : {}),
    ...(invitation.invitedBy ? { invitedBy: invitation.invitedBy } : {}),
    joinedAt: Date.now(),
  };

  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: SPACE_MEMBERS_TABLE,
            Item: accepted,
            ConditionExpression: 'attribute_not_exists(userId)',
          },
        },
        {
          Delete: {
            TableName: SPACE_MEMBERS_TABLE,
            Key: { spaceId: invitation.spaceId, userId: invitation.userId },
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

/** Every course invitation addressed to an email address. */
export async function listSpaceInvitationsForEmail(email: string): Promise<SpaceMember[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: SPACE_MEMBERS_TABLE,
      IndexName: INVITE_EMAIL_INDEX,
      KeyConditionExpression: '#email = :email',
      ExpressionAttributeNames: { '#email': 'invitedEmail' },
      ExpressionAttributeValues: { ':email': email },
      ScanIndexForward: false,
    }),
  );

  // The index carries every row that has the attribute, so the status is
  // filtered here rather than in the key.
  return ((res.Items ?? []) as SpaceMember[]).filter((member) => member.status === 'INVITED');
}

/**
 * A course membership as the API hands it out.
 *
 * The stored row is never returned as-is, exactly as with the organization
 * roster: an `INVITED` row is keyed by an email address, and an email address is
 * the last thing a client should be told to use as an identifier.
 */
export interface ApiSpaceMember {
  /** Cognito `sub` of the member, or the invited address while `pending`. */
  userId: string;
  role: SpaceMemberRole;
  /** True while the invitation has not been accepted: the role is not in force. */
  pending: boolean;
  /** Sent to whoever may manage the roster, and to the invited person. */
  email?: string;
  /** What they call themselves, from their profile. Absent when they have none. */
  name?: string;
  /** A signed URL for their profile photo, when they have one. */
  photoUrl?: string;
  isYou: boolean;
  /** Whether the caller is the one who can accept it. */
  isInvitationForYou: boolean;
  invitedBy?: string;
  joinedAt: number;
}

/**
 * Presents a course membership to the caller.
 *
 * An invitation is addressed to an address rather than to a `sub`, so the caller
 * claims one by being signed in as that address — knowable from the claims the
 * authorizer already put on the request, with no lookup.
 *
 * The name and photo are passed in rather than resolved here, because they come
 * from a profile and from a bucket signature, and the roster is the one caller
 * that has a batch of them to look up at once. A membership with no account
 * behind it — an outstanding invitation — has neither.
 */
export function toApiSpaceMember(
  member: SpaceMember,
  viewer: AuthUser,
  includeEmail: boolean,
  person?: { name?: string; photoUrl?: string },
): ApiSpaceMember {
  const pending = member.status === 'INVITED';
  const invitedEmail = member.invitedEmail?.toLowerCase();
  const isInvitationForYou =
    pending && Boolean(invitedEmail) && invitedEmail === viewer.email?.toLowerCase();

  return {
    userId: member.userId,
    role: member.role,
    pending,
    ...(member.email && (includeEmail || isInvitationForYou) ? { email: member.email } : {}),
    ...(person?.name ? { name: person.name } : {}),
    ...(person?.photoUrl ? { photoUrl: person.photoUrl } : {}),
    isYou: !pending && member.userId === viewer.userId,
    isInvitationForYou,
    ...(member.invitedBy ? { invitedBy: member.invitedBy } : {}),
    joinedAt: member.joinedAt,
  };
}

/**
 * The page a course invitation is claimed on.
 *
 * The marketplace, not the studio, and the difference is who the invitation is
 * addressed to. An offer to *take* a course belongs to the app courses are taken
 * in — the studio is where they are written, and an invited person who has no
 * business in the organization around the course has no business in the studio
 * either: it would greet them with a rail of authoring screens they cannot use.
 * The marketplace's `/join` page reads the invitation and opens the course.
 *
 * Just the course id, because that is what the offer is for. An invitation is
 * claimed by the address it was sent to rather than by a token in the link, so
 * there is nothing else the URL has to carry.
 */
export function spaceInvitationUrl(spaceId: string): string {
  return `${env.marketplaceBaseUrl}/join/${encodeURIComponent(spaceId)}`;
}

/**
 * Sends the email for a pending membership, and reports what happened.
 *
 * One function for inviting and for re-sending, because they are the same act:
 * if an offer is already outstanding, sending it again *is* the invite.
 */
export async function sendSpaceInvitationFor(input: {
  invitation: SpaceMember;
  spaceTitle: string;
  organizationName: string;
  inviterName: string;
}): Promise<MailDelivery> {
  const email = input.invitation.invitedEmail ?? input.invitation.email;
  if (!email) {
    return { sent: false, error: 'This invitation has no email address on it.' };
  }

  return sendSpaceInvitationEmail({
    to: email,
    spaceTitle: input.spaceTitle,
    organizationName: input.organizationName,
    role: input.invitation.role,
    invitedBy: input.inviterName,
    inviteUrl: spaceInvitationUrl(input.invitation.spaceId),
  });
}

/** Thrown when somebody registers for a course they are already in. */
export class AlreadyEnrolledError extends Error {
  constructor(userId: string) {
    super(`${userId} is already in this course`);
    this.name = 'AlreadyEnrolledError';
  }
}

/**
 * Puts somebody in a course because they asked to be.
 *
 * This is the one membership nobody was invited to: the course is listed in the
 * marketplace, the caller read it and registered. They join as a student —
 * registering is taking a course, and the roles that run one are given by
 * whoever runs it — and the write is conditional on the row being absent so
 * that registering twice, or two tabs registering at once, leaves the first
 * membership alone rather than rewriting it.
 */
export async function enrollInSpace(input: {
  spaceId: string;
  organizationId: string;
  userId: string;
  /** The caller's verified address, when their account has one. */
  email?: string;
}): Promise<SpaceMember> {
  const member: SpaceMember = {
    spaceId: input.spaceId,
    userId: input.userId,
    organizationId: input.organizationId,
    role: 'STUDENT',
    status: 'ACTIVE',
    ...(input.email ? { email: input.email } : {}),
    joinedAt: Date.now(),
  };

  try {
    await client.send(
      new PutCommand({
        TableName: SPACE_MEMBERS_TABLE,
        Item: member,
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new AlreadyEnrolledError(input.userId);
    throw err;
  }

  return member;
}
