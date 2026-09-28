'use client';

import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import {
  GraduationCapIcon,
  Loader2Icon,
  MailIcon,
  MailPlusIcon,
  UserMinusIcon,
  UserPlusIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRemoveSpaceMember,
  useSpaceMemberCandidates,
  useUpdateSpaceMember,
} from '@api/modules/space-member/space-member.queries';
import { PersonAvatar } from '@play/ui';
import type { SpaceMemberApi } from '@play/types';
import { BlockLabel } from '@/components/shell/page-card';
import { AddInstructorDialog } from './add-instructor-dialog';
import { InviteSpaceMemberDialog } from './invite-space-member-dialog';

/**
 * Who teaches this course.
 *
 * The roles have always been on the roster, three tabs away, mixed in with the
 * students — which is the right place for managing a membership and the wrong
 * place to answer the question an author actually has: who is this course
 * credited to? That is what this is, and it is the same answer the marketplace
 * draws under the course's own name.
 *
 * It reads the roster rather than the public list the marketplace reads, and
 * says the two things a roster can that a public page cannot: **which row is the
 * account you are signed in as**, and whether the person listed has actually
 * accepted. Both matter more than they look. The credit belongs to an account,
 * not to a person's name — somebody with a work address and a personal one has
 * two accounts and two profiles, and an author who assigns the wrong one sees
 * their own name and photo missing from a course they teach with nothing on
 * screen to explain it. An invitation that has not been accepted is the other
 * half of the same confusion: it is not a credit yet, and the row says so.
 */
export function SpaceInstructorsCard({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}) {
  const { data, isLoading, isError, error } = useSpaceMemberCandidates(spaceId);
  const update = useUpdateSpaceMember(spaceId);

  const members = data?.members ?? [];
  const instructors = members.filter((member) => member.role === 'INSTRUCTOR');

  /**
   * Which row is the caller's own.
   *
   * Taken from the roster rather than by comparing ids with the profile: the API
   * already answers "is this you" for every row it hands out, and an answer that
   * does not depend on a second request is an answer that is there when the
   * second one has not arrived.
   */
  const me = members.find((member) => member.isYou);
  const iTeachIt = Boolean(me && me.role === 'INSTRUCTOR' && !me.pending);

  async function teachMyself() {
    if (!me) return;

    try {
      await update.mutateAsync({ memberId: me.userId, role: 'INSTRUCTOR' });
      toast.success('You now teach this course');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make you an instructor');
    }
  }

  return (
    <section className="grid gap-3">
      <BlockLabel
        action={
          canManage ? (
            <div className="flex shrink-0 items-center gap-2">
              <InviteSpaceMemberDialog
                spaceId={spaceId}
                defaultRole="INSTRUCTOR"
                trigger={
                  <Button variant="outline" size="sm">
                    <MailPlusIcon />
                    Invite
                  </Button>
                }
              />
              <AddInstructorDialog
                spaceId={spaceId}
                trigger={
                  <Button size="sm">
                    <UserPlusIcon />
                    Add instructor
                  </Button>
                }
              />
            </div>
          ) : undefined
        }
      >
        Instructors
      </BlockLabel>

      <div className="rounded-3xl border border-border/60 bg-card p-5">
        {isLoading ? (
          <div className="grid gap-3">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : isError ? (
          /* Said rather than drawn as an empty list: "nobody teaches this" and
             "the answer did not arrive" are different facts about a course, and
             only one of them is a reason to add somebody. */
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Could not load the instructors'}
          </p>
        ) : (
          <>
            {instructors.length === 0 ? (
              <div className="flex flex-col items-start gap-1.5">
                <p className="text-sm font-medium">Nobody teaches this course yet</p>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  A course with no instructor is published with no name on it. Whoever is added
                  here is credited on its marketplace page, with the photo and description from
                  their own profile.
                </p>
              </div>
            ) : (
              <ul className="grid gap-2">
                {instructors.map((member) => (
                  <InstructorRow
                    key={member.userId}
                    spaceId={spaceId}
                    member={member}
                    canManage={canManage}
                  />
                ))}
              </ul>
            )}

            {/* Only for whoever can do something about it, and only when it is
                true: an author expecting their own name on a course they teach,
                looking at a list of somebody else's, has no way to tell that the
                credit follows whichever account was assigned. Putting yourself
                on the list is one click from here rather than a menu three tabs
                away, because crediting yourself is the ordinary case — and it is
                the only case on a course nobody teaches yet. */}
            {canManage && !iTeachIt && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {me ? (
                  <>
                    <Button
                      size="sm"
                      variant={instructors.length === 0 ? 'default' : 'outline'}
                      disabled={update.isPending}
                      onClick={() => void teachMyself()}
                    >
                      {update.isPending ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <GraduationCapIcon />
                      )}
                      Teach this course
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      You are not credited on it yet. This names you on its marketplace page, with
                      the photo and description from your profile.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    You are not in this course, so nothing here names you. Invite your own address
                    as an instructor above, then accept it from the course page.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * One row: the account that holds the role, and whether it is anybody yet.
 *
 * An invitation and a membership are drawn differently on purpose. One is a
 * credit; the other is an offer that becomes one when somebody accepts it, and
 * an author who sent an invitation and then looks for their name on the
 * marketplace needs the row to say which of the two they are looking at.
 *
 * Your own row is marked rather than special-cased: the credit belongs to an
 * account, and two accounts for one person look identical by name.
 */
function InstructorRow({
  spaceId,
  member,
  canManage,
}: {
  spaceId: string;
  member: SpaceMemberApi;
  canManage: boolean;
}) {
  const update = useUpdateSpaceMember(spaceId);
  const remove = useRemoveSpaceMember(spaceId);

  const busy = update.isPending || remove.isPending;
  const name = member.name ?? member.email ?? `Member ${member.userId.slice(0, 6)}`;

  async function standDown() {
    try {
      if (member.pending) {
        await remove.mutateAsync(member.userId);
        toast.success('Invitation withdrawn');
        return;
      }
      await update.mutateAsync({ memberId: member.userId, role: 'STUDENT' });
      toast.success(`${name} no longer teaches this course`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change their role');
    }
  }

  // Standing *somebody else* down, and withdrawing an invitation nobody has
  // accepted: taking yourself off a course is done from the roster, which is
  // where the rest of what you are to it is managed.
  const canAct = canManage && !member.isYou;

  return (
    <li className="flex items-center gap-3 rounded-xl border px-4 py-3">
      {member.pending ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted/40">
          <MailIcon className="size-4 text-muted-foreground" />
        </div>
      ) : (
        <PersonAvatar name={name} photoUrl={member.photoUrl} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{name}</p>
          {member.isYou && (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              This is you
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {member.pending
            ? 'Invited — not credited until they accept.'
            : /* The address is the only thing that tells two accounts of one
                 person apart, and the API sends it to whoever may manage the
                 roster. */
              (member.email ?? 'Teaches this course')}
        </p>
      </div>

      <Badge variant={member.pending ? 'outline' : 'secondary'} className="shrink-0">
        Instructor
      </Badge>

      {canAct && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={() => void standDown()}
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <UserMinusIcon />}
          {member.pending ? 'Withdraw' : 'Stand down'}
        </Button>
      )}
    </li>
  );
}
