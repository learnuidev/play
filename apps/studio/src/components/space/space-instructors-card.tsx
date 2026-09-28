'use client';

import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { Loader2Icon, MailPlusIcon, UserMinusIcon, UserPlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  useSpaceInstructors,
  useUpdateSpaceMember,
} from '@api/modules/space-member/space-member.queries';
import { PersonAvatar } from '@play/ui';
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
 * Assigning is deliberate and it is the roster's own operation: somebody is a
 * member first, and "Add instructor" promotes them. Somebody who is not in the
 * course at all is invited with the role, which is the one path an email address
 * can take — there is no id to pick for a person who has no account.
 */
export function SpaceInstructorsCard({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}) {
  const { data, isLoading, isError, error } = useSpaceInstructors(spaceId);
  const instructors = data?.instructors ?? [];

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
        ) : instructors.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm font-medium">Nobody teaches this course yet</p>
            <p className="max-w-2xl text-sm text-muted-foreground">
              A course with no instructor is published with no name on it. Whoever you add here is
              credited on its marketplace page, with the photo and description from their own
              profile.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {instructors.map((instructor) => (
              <InstructorRow
                key={instructor.userId}
                spaceId={spaceId}
                instructor={instructor}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * One instructor: their face, their name, and the way off the list.
 *
 * Standing down is one action rather than a role picker, because it is the only
 * thing this panel is about — a course's roles are its roster's business, and
 * the roster is where all three of them are offered. What it does is the
 * ordinary thing: they go back to being a student, which is what somebody in a
 * course is until they are something else.
 */
function InstructorRow({
  spaceId,
  instructor,
  canManage,
}: {
  spaceId: string;
  instructor: { userId: string; name: string; bio: string; photoUrl?: string };
  canManage: boolean;
}) {
  const update = useUpdateSpaceMember(spaceId);

  async function standDown() {
    try {
      await update.mutateAsync({ memberId: instructor.userId, role: 'STUDENT' });
      toast.success(`${instructor.name} no longer teaches this course`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change their role');
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border px-4 py-3">
      <PersonAvatar name={instructor.name} photoUrl={instructor.photoUrl} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{instructor.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {instructor.bio || 'Teaches this course'}
        </p>
      </div>

      <Badge variant="secondary" className="shrink-0">
        Instructor
      </Badge>

      {canManage && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          disabled={update.isPending}
          onClick={() => void standDown()}
        >
          {update.isPending ? <Loader2Icon className="animate-spin" /> : <UserMinusIcon />}
          Stand down
        </Button>
      )}
    </li>
  );
}
