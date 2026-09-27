import { randomBytes } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { listCompletionsInSpace } from './completions';
import { listAllContentsBySpace } from './contents';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';
import type { RewardGrant, RewardGrantStatus, RewardMilestone, SpaceReward } from '../types';

export const SPACE_REWARDS_TABLE = env.spaceRewardsTableName;
export const REWARD_GRANTS_TABLE = env.rewardGrantsTableName;

/** GSI: one course's rewards, oldest first. */
const SPACE_CREATED_INDEX = 'SpaceCreatedIndex';

/** GSI: everything a course has given out. */
const SPACE_GRANTED_INDEX = 'SpaceGrantedIndex';

/** GSI: everything one learner holds. */
const USER_GRANTED_INDEX = 'UserGrantedIndex';

/** The `grantedBy` value a milestone writes, as against an instructor's `sub`. */
export const SYSTEM_GRANTOR = 'SYSTEM';

export async function putReward(reward: SpaceReward): Promise<void> {
  await client.send(new PutCommand({ TableName: SPACE_REWARDS_TABLE, Item: reward }));
}

export async function getReward(rewardId: string): Promise<SpaceReward | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: SPACE_REWARDS_TABLE, Key: { rewardId } }),
  );
  return res.Item as SpaceReward | undefined;
}

export interface UpdateRewardPatch {
  name?: string;
  description?: string;
  milestone?: RewardMilestone;
  amountCents?: number | null;
  currency?: string | null;
  codePrefix?: string | null;
  instructions?: string | null;
  grantLimit?: number | null;
  active?: boolean;
}

/**
 * Changes a reward's definition.
 *
 * Only the definition, never its grants: a reward that has been earned is a
 * promise already made, and raising the bar afterwards must change what the next
 * person has to do rather than take back what somebody already holds.
 */
export async function updateReward(rewardId: string, patch: UpdateRewardPatch): Promise<void> {
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
  if (patch.milestone !== undefined) {
    names['#milestone'] = 'milestone';
    values[':milestone'] = patch.milestone;
    set += ', #milestone = :milestone';
  }
  if (patch.active !== undefined) {
    names['#active'] = 'active';
    values[':active'] = patch.active;
    set += ', #active = :active';
  }

  // A field the caller cleared is removed rather than stored as null, so
  // "no gift-card amount" has one representation rather than two.
  for (const [field, value] of [
    ['amountCents', patch.amountCents],
    ['currency', patch.currency],
    ['codePrefix', patch.codePrefix],
    ['instructions', patch.instructions],
    ['grantLimit', patch.grantLimit],
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
      TableName: SPACE_REWARDS_TABLE,
      Key: { rewardId },
      UpdateExpression: removes.length ? `${set} REMOVE ${removes.join(', ')}` : set,
      ConditionExpression: 'attribute_exists(rewardId)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** Deletes a reward and the grants under it. */
export async function deleteReward(rewardId: string): Promise<void> {
  const grants = await listGrantsForReward(rewardId);

  for (const grant of grants) {
    await client
      .send(
        new DeleteCommand({
          TableName: REWARD_GRANTS_TABLE,
          Key: { rewardId, userId: grant.userId },
        }),
      )
      .catch((err) => {
        console.error('Reward grant cleanup failed', { rewardId, userId: grant.userId, err });
      });
  }

  await client.send(new DeleteCommand({ TableName: SPACE_REWARDS_TABLE, Key: { rewardId } }));
}

/** A course's rewards, in the order they were added. */
export async function listRewardsBySpace(spaceId: string): Promise<SpaceReward[]> {
  const rewards: SpaceReward[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: SPACE_REWARDS_TABLE,
        IndexName: SPACE_CREATED_INDEX,
        KeyConditionExpression: '#spaceId = :spaceId',
        ExpressionAttributeNames: { '#spaceId': 'spaceId' },
        ExpressionAttributeValues: { ':spaceId': spaceId },
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    rewards.push(...((res.Items ?? []) as SpaceReward[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return rewards;
}

/**
 * Writes a grant, once per person.
 *
 * The condition is the whole point: the table is keyed by reward and member, so
 * `attribute_not_exists` turns "has this already been issued?" into something
 * DynamoDB enforces rather than something a reader has to check and race. A
 * learner crossing a milestone twice — reaching lesson ten, then unmarking and
 * remarking it — gets the reward once.
 *
 * Returns the grant that is now in force, and whether this call was the one that
 * made it so: the counter on the reward only moves for a new one.
 */
export async function putGrant(
  grant: RewardGrant,
): Promise<{ grant: RewardGrant; created: boolean }> {
  try {
    await client.send(
      new PutCommand({
        TableName: REWARD_GRANTS_TABLE,
        Item: grant,
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    );
  } catch (err) {
    if (!isConditionalCheckFailed(err)) throw err;
    const existing = await getGrant(grant.rewardId, grant.userId);
    if (existing) return { grant: existing, created: false };
    throw err;
  }

  await client.send(
    new UpdateCommand({
      TableName: SPACE_REWARDS_TABLE,
      Key: { rewardId: grant.rewardId },
      UpdateExpression: 'ADD #grantCount :one SET updatedAt = :now',
      ExpressionAttributeNames: { '#grantCount': 'grantCount' },
      ExpressionAttributeValues: { ':one': 1, ':now': Date.now() },
    }),
  );

  return { grant, created: true };
}

export async function getGrant(rewardId: string, userId: string): Promise<RewardGrant | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: REWARD_GRANTS_TABLE, Key: { rewardId, userId } }),
  );
  return res.Item as RewardGrant | undefined;
}

/** One reward's grants, newest first. */
export async function listGrantsForReward(rewardId: string): Promise<RewardGrant[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: REWARD_GRANTS_TABLE,
      KeyConditionExpression: '#rewardId = :rewardId',
      ExpressionAttributeNames: { '#rewardId': 'rewardId' },
      ExpressionAttributeValues: { ':rewardId': rewardId },
      ScanIndexForward: false,
    }),
  );

  return (res.Items ?? []) as RewardGrant[];
}

/** Everything a course has given out, newest first. */
export async function listGrantsForSpace(spaceId: string, limit: number): Promise<RewardGrant[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: REWARD_GRANTS_TABLE,
      IndexName: SPACE_GRANTED_INDEX,
      KeyConditionExpression: '#spaceId = :spaceId',
      ExpressionAttributeNames: { '#spaceId': 'spaceId' },
      ExpressionAttributeValues: { ':spaceId': spaceId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  return (res.Items ?? []) as RewardGrant[];
}

/** Everything one learner holds, newest first. */
export async function listGrantsForUser(userId: string): Promise<RewardGrant[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: REWARD_GRANTS_TABLE,
      IndexName: USER_GRANTED_INDEX,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
    }),
  );

  return (res.Items ?? []) as RewardGrant[];
}

/**
 * Takes a grant back, or records that it was used.
 *
 * The row stays: what somebody was given, and what became of it, is the record a
 * reward system exists to keep. Only the status moves.
 */
export async function setGrantStatus(
  rewardId: string,
  userId: string,
  status: RewardGrantStatus,
): Promise<void> {
  const now = Date.now();

  await client.send(
    new UpdateCommand({
      TableName: REWARD_GRANTS_TABLE,
      Key: { rewardId, userId },
      // `redeemedAt` only means something on a redemption, so it is stamped then
      // and left alone otherwise — a revocation is not a moment of use.
      UpdateExpression:
        status === 'REDEEMED'
          ? 'SET #status = :status, updatedAt = :now, redeemedAt = :now'
          : 'SET #status = :status, updatedAt = :now',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status, ':now': now },
    }),
  );
}

/** Removes a grant outright — a reward issued to the wrong person. */
export async function deleteGrant(rewardId: string, userId: string): Promise<void> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: REWARD_GRANTS_TABLE,
        Key: { rewardId, userId },
        ConditionExpression: 'attribute_exists(userId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return;
    throw err;
  }

  await client.send(
    new UpdateCommand({
      TableName: SPACE_REWARDS_TABLE,
      Key: { rewardId },
      UpdateExpression: 'ADD #grantCount :minusOne SET updatedAt = :now',
      ExpressionAttributeNames: { '#grantCount': 'grantCount' },
      ExpressionAttributeValues: { ':minusOne': -1, ':now': Date.now() },
    }),
  );
}

/** How far along a milestone is, as the reward list shows it. */
export interface MilestoneProgress {
  /** Lessons the learner has finished. */
  completed: number;
  /** Lessons the course has. */
  total: number;
  /** `completed / total` as a whole percentage, 0 when there is nothing to do. */
  percent: number;
}

/** Where a learner stands in a course, as the milestones are measured. */
export async function milestoneProgress(
  spaceId: string,
  userId: string,
): Promise<MilestoneProgress> {
  const [completions, contents] = await Promise.all([
    listCompletionsInSpace(userId, spaceId),
    listAllContentsBySpace(spaceId),
  ]);

  const total = contents.contents.length;
  const completed = completions.length;

  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

/** Whether a learner has done what a reward asks for. */
export function milestoneReached(milestone: RewardMilestone, progress: MilestoneProgress): boolean {
  if (milestone.type === 'PERCENT_COMPLETE') return progress.percent >= milestone.value;
  return progress.completed >= milestone.value;
}

/**
 * A code to redeem, for the kinds that carry one.
 *
 * Deliberately short and unambiguous: this is read off a screen and typed into
 * somebody else's checkout, so the alphabet leaves out the characters people
 * misread — no `I`, `L`, `O`, `U`, `0` or `1` — and the random part comes from
 * `crypto` rather than `Math.random`, because a guessable coupon is a coupon
 * anybody can spend.
 */
export function generateRewardCode(prefix: string | undefined, rewardId: string): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) code += alphabet[byte % alphabet.length];

  // The reward's own tail makes a collision across two rewards impossible, which
  // is the only way two members can hold the same code.
  const tail = rewardId.slice(-4).toUpperCase();
  return [prefix?.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), code, tail]
    .filter(Boolean)
    .join('-');
}

/**
 * The grants a learner's progress has earned them, written and returned.
 *
 * Called when a lesson is marked done, which is the only moment progress
 * changes. Every active reward is tested rather than only the ones near their
 * milestone, because a milestone can be crossed in one step by unmarking a
 * lesson earlier in the course and marking it again — and because "check them
 * all" is three reads, while tracking which one is next would be state that
 * drifts the first time an instructor edits a milestone.
 *
 * A reward that has hit its `grantLimit` is skipped: the limit exists so a
 * course can offer ten gift cards and hand out ten.
 *
 * Never throws: this runs beside a learner marking a lesson done, and a reward
 * that could not be issued must not turn into a lesson that could not be
 * completed.
 */
export async function grantEarnedRewards(input: {
  spaceId: string;
  organizationId: string;
  userId: string;
}): Promise<RewardGrant[]> {
  try {
    const rewards = (await listRewardsBySpace(input.spaceId)).filter(
      (reward) => reward.active && (reward.grantLimit === undefined || reward.grantCount < reward.grantLimit),
    );

    if (rewards.length === 0) return [];

    const progress = await milestoneProgress(input.spaceId, input.userId);
    const issued: RewardGrant[] = [];

    for (const reward of rewards) {
      if (!milestoneReached(reward.milestone, progress)) continue;

      const now = Date.now();
      // A custom reward is handed over by a person, so there is nothing to
      // generate: the grant records that it is owed, and the code is the part a
      // checkout would have taken.
      const code =
        reward.kind === 'CUSTOM' ? {} : { code: generateRewardCode(reward.codePrefix, reward.rewardId) };

      const { grant, created } = await putGrant({
        rewardId: reward.rewardId,
        userId: input.userId,
        spaceId: input.spaceId,
        organizationId: input.organizationId,
        ...code,
        status: 'ISSUED',
        grantedBy: SYSTEM_GRANTOR,
        progress:
          reward.milestone.type === 'PERCENT_COMPLETE' ? progress.percent : progress.completed,
        grantedAt: now,
        updatedAt: now,
      });

      if (created) issued.push(grant);
    }

    return issued;
  } catch (err) {
    console.error('Reward evaluation failed', { spaceId: input.spaceId, userId: input.userId, err });
    return [];
  }
}

/**
 * Where a learner's rewards for one course live.
 *
 * In the marketplace, not the studio: the person being given something is taking
 * the course, and the studio is the app courses are written in. The link lands
 * on the course's own rewards page so that what the email promised — *this*
 * reward, in *this* course — is what is on screen when it opens.
 */
export function courseRewardsUrl(spaceId: string): string {
  return `${env.marketplaceBaseUrl}/courses/${encodeURIComponent(spaceId)}/rewards`;
}
