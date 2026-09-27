'use client';

import { useState } from 'react';
import {
  CreditCardIcon,
  GiftIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TargetIcon,
  TicketIcon,
  TrashIcon,
  UndoIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  REWARD_GRANT_STATUS_LABELS,
  REWARD_KIND_LABELS,
  REWARD_MILESTONE_UNITS,
  type RewardGrant,
  type RewardGrantStatus,
  type RewardMilestone,
  type RewardWithGrants,
  type SpaceMemberApi,
} from '@play/types';
import {
  useDeleteReward,
  useRevokeRewardGrant,
  useRewards,
  useUpdateReward,
} from '@api/modules/reward/reward.queries';
import { useSpaceMembers } from '@api/modules/space-member/space-member.queries';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { BlockLabel, EmptyState } from '@/components/shell/page-card';
import { GrantRewardDialog } from '@/components/space/grant-reward-dialog';
import { RewardDialog } from '@/components/space/reward-dialog';

/** A redeemed reward is the good outcome, so it is the one that reads as emphasis. */
const GRANT_STATUS_VARIANTS: Record<RewardGrantStatus, 'default' | 'secondary' | 'outline'> = {
  ISSUED: 'secondary',
  REDEEMED: 'default',
  REVOKED: 'outline',
};

/**
 * A milestone in words, as a card reads it: “After 5 lessons”, “At 100% of the
 * course”. The unit is the shared one the form uses, so a card and the dialog
 * that wrote it cannot drift apart.
 */
function milestoneSummary(milestone: RewardMilestone): string {
  if (milestone.type === 'PERCENT_COMPLETE') {
    return `At ${milestone.value}${REWARD_MILESTONE_UNITS.PERCENT_COMPLETE}`;
  }

  // The shared unit is plural, which is right for every value but one.
  const unit = milestone.value === 1 ? 'lesson' : REWARD_MILESTONE_UNITS.LESSONS_COMPLETED;
  return `After ${milestone.value} ${unit}`;
}

/** Cents back into the unit a person reads money in. */
function formatAmount(amountCents: number, currency?: string): string {
  const amount = (amountCents / 100).toFixed(2);
  return currency ? `${amount} ${currency}` : amount;
}

function formatGrantedAt(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Who holds a grant, resolved against the roster.
 *
 * A grant names a member by id, and an id is not something anybody recognises. A
 * grant can also outlive the membership it names — somebody removed from the
 * course keeps what they were given — so the id's short tail is the fallback
 * rather than a blank row.
 */
function holderLabel(member: SpaceMemberApi | undefined, userId: string): string {
  if (!member) return `Member ${userId.slice(0, 6)}`;
  if (member.isYou) return 'You';
  return member.email ?? `Member ${userId.slice(0, 6)}`;
}

function grantCountLabel(reward: RewardWithGrants): string {
  return reward.grantLimit !== undefined
    ? `${reward.grantCount} of ${reward.grantLimit} granted`
    : `${reward.grantCount} granted`;
}

/**
 * One person's grant: what they hold, where it stands, and how to take it back.
 *
 * A revoked grant offers nothing to take back, so the action is not there: the
 * record is the point of it.
 */
function GrantRow({
  spaceId,
  reward,
  grant,
  member,
  canManage,
}: {
  spaceId: string;
  reward: RewardWithGrants;
  grant: RewardGrant;
  member?: SpaceMemberApi;
  canManage: boolean;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const revoke = useRevokeRewardGrant(spaceId);

  const holder = holderLabel(member, grant.userId);

  async function takeBack() {
    try {
      const { removed } = await revoke.mutateAsync({
        rewardId: reward.rewardId,
        memberId: grant.userId,
      });

      // Two different acts, and the toast says which one happened: a grant
      // nobody used is removed and the reward's count goes back down, while one
      // that was redeemed is marked revoked and the row stays. Something was
      // handed over and used, and deleting the record of it would make the books
      // agree by deletion.
      toast.success(removed ? `Taken back from ${holder}` : `Marked revoked for ${holder}`, {
        description: removed
          ? 'It had not been used, so it was removed and the count went back down.'
          : 'They had already used it, so the grant stays on record as revoked.',
      });
      setConfirming(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not take the reward back');
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2">
      <span className="text-sm font-medium">{holder}</span>

      {grant.code && (
        <code className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
          {grant.code}
        </code>
      )}

      <Badge
        variant={GRANT_STATUS_VARIANTS[grant.status]}
        className={grant.status === 'REVOKED' ? 'font-normal text-muted-foreground' : undefined}
      >
        {REWARD_GRANT_STATUS_LABELS[grant.status]}
      </Badge>

      <span className="text-xs text-muted-foreground">
        Granted {formatGrantedAt(grant.grantedAt)}
      </span>

      {grant.note && <span className="text-xs text-muted-foreground">· {grant.note}</span>}

      {canManage && grant.status !== 'REVOKED' && (
        <span className="ml-auto flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground">Take it back?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void takeBack()}
                disabled={revoke.isPending}
              >
                {revoke.isPending && <Loader2Icon className="animate-spin" />}
                Yes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                No
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <UndoIcon />
              Take back
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

/**
 * One reward: what it is, what earns it, who holds it, and what can be done about
 * it.
 *
 * Pausing and deleting are deliberately not the same thing. Pausing stops the
 * reward being earned and handed out, and leaves every grant alone — what was
 * earned is a promise already made. Deleting takes the grants with it, which is
 * why the confirmation says so before it happens.
 */
function RewardCard({
  spaceId,
  reward,
  canManage,
  memberById,
}: {
  spaceId: string;
  reward: RewardWithGrants;
  canManage: boolean;
  memberById: Map<string, SpaceMemberApi>;
}): JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const update = useUpdateReward(spaceId);
  const remove = useDeleteReward(spaceId);

  async function togglePaused() {
    const pausing = reward.active;

    try {
      await update.mutateAsync({ rewardId: reward.rewardId, active: !reward.active });
      toast.success(pausing ? 'Reward paused' : 'Reward resumed', {
        description: pausing
          ? 'It stops being earned and handed out, and everybody who already holds it keeps it.'
          : 'Anybody who reaches the milestone from now on earns it.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the reward');
    }
  }

  async function deleteReward() {
    try {
      await remove.mutateAsync(reward.rewardId);
      toast.success('Reward deleted', {
        description: 'Its grants went with it. Pausing would have left them in place.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the reward');
    }
  }

  return (
    <article className="grid gap-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{reward.name}</h3>
            <Badge variant="secondary">{REWARD_KIND_LABELS[reward.kind]}</Badge>
            {!reward.active && (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Paused
              </Badge>
            )}
          </div>

          {reward.description && (
            <p className="mt-1 text-sm text-muted-foreground">{reward.description}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <TargetIcon className="size-3.5" />
              {milestoneSummary(reward.milestone)}
            </span>

            {reward.amountCents !== undefined && (
              <span className="inline-flex items-center gap-1.5">
                <CreditCardIcon className="size-3.5" />
                {formatAmount(reward.amountCents, reward.currency)}
              </span>
            )}

            {reward.codePrefix && (
              <span className="inline-flex items-center gap-1.5">
                <TicketIcon className="size-3.5" />
                Codes start with{' '}
                <code className="font-mono text-[11px]">{reward.codePrefix}</code>
              </span>
            )}

            <span className="inline-flex items-center gap-1.5">
              <GiftIcon className="size-3.5" />
              {grantCountLabel(reward)}
            </span>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {/* A paused reward keeps its grants but hands out nothing new, so
                the one way to add a grant is not offered until it is resumed. */}
            {reward.active && (
              <GrantRewardDialog
                spaceId={spaceId}
                reward={reward}
                trigger={
                  <Button size="sm" variant="secondary">
                    <GiftIcon />
                    Grant
                  </Button>
                }
              />
            )}

            <RewardDialog
              spaceId={spaceId}
              reward={reward}
              trigger={
                <Button size="sm" variant="ghost">
                  <PencilIcon />
                  Edit
                </Button>
              }
            />

            <Button
              size="sm"
              variant="ghost"
              onClick={() => void togglePaused()}
              disabled={update.isPending}
            >
              {update.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : reward.active ? (
                <PauseIcon />
              ) : (
                <PlayIcon />
              )}
              {reward.active ? 'Pause' : 'Resume'}
            </Button>

            {confirmingDelete ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {reward.grantCount > 0
                    ? `Delete it and its ${reward.grantCount} ${
                        reward.grantCount === 1 ? 'grant' : 'grants'
                      }? Pausing would leave them alone.`
                    : 'Delete this reward? Pausing would leave it in place.'}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void deleteReward()}
                  disabled={remove.isPending}
                >
                  {remove.isPending && <Loader2Icon className="animate-spin" />}
                  Yes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  No
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                <TrashIcon />
                Delete
              </Button>
            )}
          </div>
        )}
      </div>

      {reward.instructions && (
        <p className="rounded-xl border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          {reward.instructions}
        </p>
      )}

      <div className="grid gap-2 border-t pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Who holds it
        </p>

        {reward.grants.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nobody yet. It is granted when somebody reaches the milestone — or by hand, from the
            button above.
          </p>
        ) : (
          <ul className="grid gap-2">
            {reward.grants.map((grant) => (
              <GrantRow
                key={grant.userId}
                spaceId={spaceId}
                reward={reward}
                grant={grant}
                member={memberById.get(grant.userId)}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/**
 * What a course gives for finishing it.
 *
 * The rewards are the course's own, and the grants under them name its members:
 * a coupon is worth something to the person who was in *this* course, and the
 * roster is what turns the ids on a grant into somebody recognisable.
 *
 * A caller who cannot manage the course sees the same list without the buttons,
 * because what a course offers is worth reading even to somebody who cannot
 * change it.
 */
export function SpaceRewardsTab({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}): JSX.Element {
  const rewardsQuery = useRewards(spaceId);
  const membersQuery = useSpaceMembers(spaceId);

  const rewards = rewardsQuery.data?.rewards ?? [];
  const members = membersQuery.data?.members ?? [];
  const memberById = new Map(members.map((member) => [member.userId, member]));

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <BlockLabel
          action={
            canManage ? (
              <RewardDialog
                spaceId={spaceId}
                trigger={
                  <Button size="sm">
                    <PlusIcon />
                    New reward
                  </Button>
                }
              />
            ) : undefined
          }
        >
          Rewards
        </BlockLabel>

        {rewardsQuery.isError ? (
          <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {rewardsQuery.error instanceof Error
                ? rewardsQuery.error.message
                : 'The rewards could not be read.'}
            </p>
          </div>
        ) : rewardsQuery.isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : rewards.length === 0 ? (
          <EmptyState
            icon={<GiftIcon className="size-5 text-muted-foreground" />}
            title="No rewards yet"
            description="A reward is what the course hands over for reaching a milestone: a coupon at five lessons, a gift card for finishing. Milestones are checked as lessons are marked done, so nobody has to hand them out."
            action={
              canManage ? (
                <RewardDialog
                  spaceId={spaceId}
                  trigger={
                    <Button>
                      <PlusIcon />
                      New reward
                    </Button>
                  }
                />
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3">
            {rewards.map((reward) => (
              <RewardCard
                key={reward.rewardId}
                spaceId={spaceId}
                reward={reward}
                canManage={canManage}
                memberById={memberById}
              />
            ))}
          </div>
        )}

        {!canManage && (
          <p className="text-xs text-muted-foreground">
            Only whoever runs a course can offer a reward or hand one out. Ask an instructor if
            something is missing.
          </p>
        )}
      </section>
    </div>
  );
}
