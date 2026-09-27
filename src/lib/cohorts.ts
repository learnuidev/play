import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Cohort, CohortMember, CohortWithMembers } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';

export const COHORTS_TABLE = env.cohortsTableName;
export const COHORT_MEMBERS_TABLE = env.cohortMembersTableName;

/** GSI: one course's cohorts, oldest first — the order they were set up in. */
const SPACE_CREATED_INDEX = 'SpaceCreatedIndex';

/** GSI: the cohorts one person is in. */
const USER_COHORT_INDEX = 'UserCohortIndex';

export async function putCohort(cohort: Cohort): Promise<void> {
  await client.send(new PutCommand({ TableName: COHORTS_TABLE, Item: cohort }));
}

export async function getCohort(cohortId: string): Promise<Cohort | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: COHORTS_TABLE, Key: { cohortId } }),
  );
  return res.Item as Cohort | undefined;
}

export interface UpdateCohortPatch {
  name?: string;
  description?: string;
  /** `null` clears a scheduled end; `undefined` leaves it as it is. */
  startAt?: number | null;
  endAt?: number | null;
}

export async function updateCohort(cohortId: string, patch: UpdateCohortPatch): Promise<void> {
  let set = 'SET updatedAt = :updatedAt';
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': Date.now() };
  const removes: string[] = [];

  if (patch.name !== undefined) {
    names['#name'] = 'name';
    values[':name'] = patch.name;
    set += ', #name = :name';
  }
  if (patch.description !== undefined) {
    names['#description'] = 'description';
    values[':description'] = patch.description;
    set += ', #description = :description';
  }

  // A cleared date is removed rather than stored as null: an absent `startAt`
  // is what "unscheduled" means everywhere this row is read.
  for (const [field, value] of [
    ['startAt', patch.startAt],
    ['endAt', patch.endAt],
  ] as const) {
    if (value === undefined) continue;
    names[`#${field}`] = field;
    if (value === null) removes.push(`#${field}`);
    else {
      values[`:${field}`] = value;
      set += `, #${field} = :${field}`;
    }
  }

  const expression = removes.length ? `${set} REMOVE ${removes.join(', ')}` : set;

  await client.send(
    new UpdateCommand({
      TableName: COHORTS_TABLE,
      Key: { cohortId },
      UpdateExpression: expression,
      ConditionExpression: 'attribute_exists(cohortId)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** One course's cohorts, with the members each of them holds. */
export async function listCohortsBySpace(spaceId: string): Promise<Cohort[]> {
  const cohorts: Cohort[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: COHORTS_TABLE,
        IndexName: SPACE_CREATED_INDEX,
        KeyConditionExpression: '#spaceId = :spaceId',
        ExpressionAttributeNames: { '#spaceId': 'spaceId' },
        ExpressionAttributeValues: { ':spaceId': spaceId },
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    cohorts.push(...((res.Items ?? []) as Cohort[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return cohorts;
}

/**
 * Deletes a cohort and everything that says who is in it.
 *
 * The membership rows are removed one at a time rather than in a transaction,
 * because a cohort of two hundred would blow through DynamoDB's hundred-item
 * transaction limit long before it blew through anything else. The cohort row
 * itself goes last: a cohort that briefly has no members is a cohort being
 * deleted, while members pointing at a cohort that no longer exists is a page
 * that renders nothing and cannot be repaired from the UI.
 */
export async function deleteCohort(cohortId: string): Promise<void> {
  const memberIds = await listCohortMemberIds(cohortId);

  for (const userId of memberIds) {
    await deleteCohortMember(cohortId, userId).catch((err) => {
      // Already gone is the state we wanted; anything else is worth knowing
      // about but not worth failing the deletion over.
      console.error('Cohort member cleanup failed', { cohortId, userId, err });
    });
  }

  await client.send(new DeleteCommand({ TableName: COHORTS_TABLE, Key: { cohortId } }));
}

/** Who is in a cohort: the association rows, and nothing else. */
export async function listCohortMemberIds(cohortId: string): Promise<string[]> {
  const ids: string[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: COHORT_MEMBERS_TABLE,
        KeyConditionExpression: '#cohortId = :cohortId',
        ExpressionAttributeNames: { '#cohortId': 'cohortId' },
        ExpressionAttributeValues: { ':cohortId': cohortId },
        ProjectionExpression: 'userId',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    for (const item of (res.Items ?? []) as Array<{ userId: string }>) ids.push(item.userId);
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return ids;
}

/** The cohorts one person is in, as association rows. */
export async function listCohortMembershipsForUser(userId: string): Promise<CohortMember[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: COHORT_MEMBERS_TABLE,
      IndexName: USER_COHORT_INDEX,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
    }),
  );

  return (res.Items ?? []) as CohortMember[];
}

/**
 * Puts somebody in a cohort.
 *
 * Idempotent on purpose: the row is the relationship, so adding a member who is
 * already in the cohort is not an error to report — it is the state the caller
 * asked for. The cohort's counter is only moved when the row was actually new,
 * which is what the condition on the write tells us.
 */
export async function addCohortMember(input: {
  cohortId: string;
  userId: string;
  spaceId: string;
  addedBy: string;
}): Promise<boolean> {
  try {
    await client.send(
      new PutCommand({
        TableName: COHORT_MEMBERS_TABLE,
        Item: {
          cohortId: input.cohortId,
          userId: input.userId,
          spaceId: input.spaceId,
          addedBy: input.addedBy,
          addedAt: Date.now(),
        } satisfies CohortMember,
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }

  await client.send(
    new UpdateCommand({
      TableName: COHORTS_TABLE,
      Key: { cohortId: input.cohortId },
      UpdateExpression: 'ADD #memberCount :one SET updatedAt = :now',
      ConditionExpression: 'attribute_exists(cohortId)',
      ExpressionAttributeNames: { '#memberCount': 'memberCount' },
      ExpressionAttributeValues: { ':one': 1, ':now': Date.now() },
    }),
  );

  return true;
}

/** Takes somebody out of a cohort. Also idempotent. */
export async function deleteCohortMember(cohortId: string, userId: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: COHORT_MEMBERS_TABLE,
        Key: { cohortId, userId },
        ConditionExpression: 'attribute_exists(userId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }

  await client.send(
    new UpdateCommand({
      TableName: COHORTS_TABLE,
      Key: { cohortId },
      UpdateExpression: 'ADD #memberCount :minusOne SET updatedAt = :now',
      ExpressionAttributeNames: { '#memberCount': 'memberCount' },
      ExpressionAttributeValues: { ':minusOne': -1, ':now': Date.now() },
    }),
  );

  return true;
}

/**
 * The cohorts with the people in them, which is what the page draws.
 *
 * The member ids of every cohort are read in sequence rather than in parallel:
 * a course has a handful of cohorts, and firing a query per cohort at once is
 * the shape that gets throttled the first time somebody makes twenty of them.
 */
export async function listCohortsWithMembers(spaceId: string): Promise<CohortWithMembers[]> {
  const cohorts = await listCohortsBySpace(spaceId);
  const withMembers: CohortWithMembers[] = [];

  for (const cohort of cohorts) {
    const memberIds = await listCohortMemberIds(cohort.cohortId);
    withMembers.push({ ...cohort, memberIds });
  }

  return withMembers;
}
