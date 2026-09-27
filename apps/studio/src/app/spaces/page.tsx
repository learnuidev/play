'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRightIcon, CompassIcon, GraduationCapIcon, MailPlusIcon } from 'lucide-react';
import { SPACE_MEMBER_ROLE_LABELS, type MyCourse } from '@/types';
import { useMyCourses, useMySpaceInvitations } from '@/modules/space-member/space-member.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shell/page-card';
import { SpaceCard } from '@/components/space/space-card';

/** One organization's courses, as the page groups them. */
interface CourseGroup {
  orgId: string;
  organizationName: string;
  courses: MyCourse[];
}

/**
 * The courses, gathered under the organization they belong to.
 *
 * Grouped rather than listed flat because a course's name is only half of what
 * it is: "Introduction to Film" from one organization and "Introduction to Film"
 * from another are different courses, and a person can be taking both. The
 * grouping is also what makes the page readable for somebody in one organization
 * and one course, which is the common case — a heading and a card rather than a
 * column of the same name repeated.
 *
 * Sorted by name, both ways: the API hands these back newest membership first,
 * which is the right order for "what did I just join" and the wrong one for
 * "where is that course I am looking for".
 */
function groupByOrganization(courses: MyCourse[]): CourseGroup[] {
  const byOrg = new Map<string, CourseGroup>();

  for (const course of courses) {
    const orgId = course.space.organizationId;
    const group = byOrg.get(orgId);

    if (group) group.courses.push(course);
    else
      byOrg.set(orgId, {
        orgId,
        organizationName: course.organizationName,
        courses: [course],
      });
  }

  // `Array.from` rather than spreading the iterator: this project targets ES5,
  // where spreading a `Map`'s values is not a thing the compiler will allow.
  const groups = Array.from(byOrg.values());
  for (const group of groups) {
    group.courses.sort((a, b) => a.space.title.localeCompare(b.space.title));
  }

  return groups.sort((a, b) => a.organizationName.localeCompare(b.organizationName));
}

/**
 * The spaces the signed-in person has access to, across every organization.
 *
 * Read from the caller's own memberships rather than from an organization's
 * course list, because a course can be offered to somebody who belongs to no
 * organization: without an organization there is no list to walk, and this page
 * is the only way back to a course after the invitation email is gone.
 *
 * A pending invitation is shown here too. It is not access yet — accepting is
 * what makes it access — but it is the other half of "what can I open", and a
 * page that showed only what you already hold would leave an invited person
 * looking at an empty screen.
 */
export default function MySpacesPage() {
  const coursesQuery = useMyCourses();
  const invitationsQuery = useMySpaceInvitations();

  const courses = coursesQuery.data?.courses ?? [];
  const invitations = invitationsQuery.data?.invitations ?? [];
  const groups = useMemo(() => groupByOrganization(courses), [courses]);

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">Your spaces</h1>
        <p className="text-[13px] text-muted-foreground">
          Every course you can open, whichever organization it belongs to.
        </p>
      </header>

      {/* Pointed at rather than repeated: an invitation is not access, and the
          invitations page is where all of them are — the same offer under two
          headings is two places to keep true. */}
      {invitations.length > 0 && (
        <Link
          href="/invites"
          className="flex items-center gap-3 rounded-xl border border-ring/40 bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/50"
        >
          <MailPlusIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm">
            {invitations.length === 1
              ? 'An invitation is waiting for you'
              : `${invitations.length} invitations are waiting for you`}
          </span>
          <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {coursesQuery.isError ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
          <p className="text-sm text-destructive">
            {coursesQuery.error instanceof Error
              ? coursesQuery.error.message
              : 'Your courses could not be read.'}
          </p>
        </div>
      ) : coursesQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-3 overflow-hidden rounded-2xl border">
              <Skeleton className="aspect-video rounded-none" />
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <EmptyState
          icon={<GraduationCapIcon className="size-5 text-muted-foreground" />}
          title={invitations.length > 0 ? 'Accept an invitation to begin' : 'No courses yet'}
          description={
            invitations.length > 0
              ? 'The course you were invited to appears here as soon as you accept it.'
              : 'A course shows up here when somebody invites you to one, or when you are added to an organization that publishes them.'
          }
          action={
            <Button variant="outline" asChild>
              <Link href={invitations.length > 0 ? '/invites' : '/organizations'}>
                <CompassIcon />
                {invitations.length > 0 ? 'See your invitations' : 'Your organizations'}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-8">
          {groups.map((group) => (
            <section key={group.orgId} className="grid gap-4">
              <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">
                {group.organizationName || 'Courses'}
              </h2>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {group.courses.map((course) => (
                  <div key={course.space.spaceId} className="grid gap-2">
                    <SpaceCard orgId={group.orgId} space={course.space} />

                    {/* What you are to the course, said only when it is not the
                        ordinary thing to be. "Student" under every card would be
                        a line that never carries information. */}
                    {course.role !== 'STUDENT' && (
                      <p className="px-1 text-xs text-muted-foreground">
                        You are {SPACE_MEMBER_ROLE_LABELS[course.role].toLowerCase()} here.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
