'use client';

import { useMemo, useState } from 'react';
import {
  CalendarDaysIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersRoundIcon,
  XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteCohort, useCohorts, useRemoveCohortMember } from '@api/modules/cohort/cohort.queries';
import { useSpaceMembers } from '@api/modules/space-member/space-member.queries';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { BlockLabel, EmptyState } from '@/components/shell/page-card';
import { spaceMemberEmail, spaceMemberName } from '@/lib/space-member';
import { CohortDialog } from '@/components/space/cohort-dialog';
import { CohortMembersDialog } from '@/components/space/cohort-members-dialog';
import type { CohortWithMembers, SpaceMemberApi } from '@play/types';

/** The cohort's run in words: both ends, one end, or nothing at all. */
function runLabel(cohort: CohortWithMembers): string {
  const start = cohort.startAt ? new Date(cohort.startAt).toLocaleDateString() : null;
  const end = cohort.endAt ? new Date(cohort.endAt).toLocaleDateString() : null;
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return 'No schedule';
}

/**
 * How one of a cohort's member ids is named, with the roster as the only source.
 *
 * The **name**, not the address, and that is the one place in the studio where
 * the two are separated: a chip is a pill a few characters wide, and an address
 * in one is a pill nobody can read. What the address is for — telling two
 * accounts of one person apart — is on the roster a tab away and in the dialog
 * behind these chips, both of which draw it in full.
 */
function memberLabel(memberId: string, roster: Map<string, SpaceMemberApi>): string {
  const member = roster.get(memberId);
  if (!member) return `Member ${memberId.slice(0, 6)}`;
  return spaceMemberName(member);
}

/** The same member, with the address, for the chip's tooltip. */
function memberTitle(memberId: string, roster: Map<string, SpaceMemberApi>): string {
  const member = roster.get(memberId);
  if (!member) return `Member ${memberId.slice(0, 6)}`;
  return [spaceMemberName(member), spaceMemberEmail(member)].filter(Boolean).join(' · ');
}

/**
 * The groups a course's members are in.
 *
 * A cohort is a label rather than a container: a September intake and a tutorial
 * group are both true of the same person at once, so a card never claims that
 * the members in it are the course's members, and taking somebody out of one
 * group says nothing about the others or about the course itself.
 *
 * The members are stored on the cohort as ids and resolved here against the
 * roster, which is why somebody who has since left the course is still drawn —
 * as their id — instead of the card quietly losing a name it was told about.
 */
export function SpaceCohortsTab({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}): JSX.Element {
  const cohortsQuery = useCohorts(spaceId);
  const membersQuery = useSpaceMembers(spaceId);
  const removeMember = useRemoveCohortMember(spaceId);
  const deleteCohort = useDeleteCohort(spaceId);

  /** The one chip whose removal is in flight, as `cohortId:memberId`. */
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  /** The one card the two-step delete is confirmed on, by cohort id. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const roster = useMemo(() => {
    const byId = new Map<string, SpaceMemberApi>();
    for (const member of membersQuery.data?.members ?? []) byId.set(member.userId, member);
    return byId;
  }, [membersQuery.data]);

  const cohorts = cohortsQuery.data?.cohorts ?? [];

  async function removeFromCohort(cohort: CohortWithMembers, memberId: string) {
    setRemovingMember(`${cohort.cohortId}:${memberId}`);
    try {
      await removeMember.mutateAsync({ cohortId: cohort.cohortId, memberId });
      toast.success(`${memberLabel(memberId, roster)} is out of ${cohort.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not take them out of the cohort');
    } finally {
      setRemovingMember(null);
    }
  }

  async function deleteGroup(cohort: CohortWithMembers) {
    try {
      await deleteCohort.mutateAsync(cohort.cohortId);
      // Deleting a cohort deletes the group, not the people in it: everyone the
      // card listed is still a member of the course, and the toast says so
      // rather than leaving the worst reading of "deleted" open.
      toast.success(`${cohort.name} deleted`, {
        description: 'Its members are still in the course — only the group is gone.',
      });
      setConfirmingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the cohort');
    }
  }

  return (
    <section className="grid gap-3">
      <BlockLabel
        action={
          canManage ? (
            <CohortDialog
              spaceId={spaceId}
              trigger={
                <Button size="sm">
                  <PlusIcon />
                  New cohort
                </Button>
              }
            />
          ) : undefined
        }
      >
        Cohorts
      </BlockLabel>

      {cohortsQuery.isError ? (
        <div className="rounded-3xl border border-dashed border-border/70 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {cohortsQuery.error instanceof Error
              ? cohortsQuery.error.message
              : 'The cohorts could not be read.'}
          </p>
        </div>
      ) : cohortsQuery.isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : cohorts.length === 0 ? (
        <EmptyState
          icon={<UsersRoundIcon className="size-5 text-muted-foreground" />}
          title="No cohorts yet"
          description="A cohort groups the course’s members — a September intake, a team, or a tutorial group. A member can be in more than one."
          action={
            canManage ? (
              <CohortDialog
                spaceId={spaceId}
                trigger={
                  <Button>
                    <PlusIcon />
                    New cohort
                  </Button>
                }
              />
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3">
          {cohorts.map((cohort) => (
            <article key={cohort.cohortId} className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{cohort.name}</h3>
                    <Badge variant="secondary">
                      {cohort.memberCount} {cohort.memberCount === 1 ? 'member' : 'members'}
                    </Badge>
                  </div>
                  {cohort.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{cohort.description}</p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDaysIcon className="size-3.5" />
                    {runLabel(cohort)}
                  </p>
                </div>

                {canManage && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {confirmingDelete === cohort.cohortId ? (
                      // The confirmation lands where the Delete button was, so
                      // the answer is given next to the question.
                      <>
                        <p className="text-xs text-muted-foreground">
                          Delete this cohort? Its members stay in the course.
                        </p>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void deleteGroup(cohort)}
                          disabled={deleteCohort.isPending}
                        >
                          {deleteCohort.isPending && <Loader2Icon className="animate-spin" />}
                          Yes
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmingDelete(null)}
                        >
                          No
                        </Button>
                      </>
                    ) : (
                      <>
                        <CohortMembersDialog
                          spaceId={spaceId}
                          cohort={cohort}
                          trigger={
                            <Button size="sm" variant="outline">
                              <UserPlusIcon />
                              Add members
                            </Button>
                          }
                        />
                        <CohortDialog
                          spaceId={spaceId}
                          cohort={cohort}
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
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmingDelete(cohort.cohortId)}
                        >
                          <Trash2Icon />
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {cohort.memberIds.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Nobody is in this cohort yet.
                </p>
              ) : (
                <ul className="mt-3 flex flex-wrap items-center gap-1.5">
                  {cohort.memberIds.map((memberId) => {
                    const busy = removingMember === `${cohort.cohortId}:${memberId}`;
                    const label = memberLabel(memberId, roster);
                    const title = memberTitle(memberId, roster);
                    return (
                      <li
                        key={memberId}
                        className="flex items-center gap-1 rounded-full border bg-muted/40 py-1 pl-3 pr-1 text-xs"
                      >
                        <span className="max-w-56 truncate" title={title}>
                          {label}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            aria-label={`Take ${label} out of ${cohort.name}`}
                            title={`Take ${label} out of ${cohort.name}`}
                            disabled={busy}
                            onClick={() => void removeFromCohort(cohort, memberId)}
                            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2Icon className="size-3 animate-spin" />
                            ) : (
                              <XIcon className="size-3" />
                            )}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-muted-foreground">
          Only an organization admin or editor can create cohorts or change who is in them. Ask an
          admin if a group is missing.
        </p>
      )}
    </section>
  );
}
