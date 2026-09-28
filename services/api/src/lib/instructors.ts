import type { PublicInstructor, Space, SpaceMember } from '../types';
import { batchGetItems } from './dynamodb';
import { batchGetProfiles, getProfile, nameFromEmail, toPublicInstructor } from './profiles';
import { listActiveInstructors, listSpaceMembershipsForUser } from './space-members';
import { SPACES_TABLE } from './spaces';

/**
 * Who teaches, and what they teach.
 *
 * `INSTRUCTOR` has been a role on a course's roster since courses had rosters —
 * "runs the course, and is named as the one who does" — but the naming was never
 * done: the role appeared on a member row and nowhere a reader of the course
 * could see it. This module is where the two halves meet: the roster says who,
 * the profile says what to call them, and the catalog says which of the courses
 * are on the marketplace.
 *
 * Nothing here is a permission. What somebody may do in a course is the
 * organization's answer and lives in `lib/access`; this is attribution, and it
 * is readable by exactly the audiences the two surfaces that draw it are for —
 * the studio's own course page, and the marketplace.
 */

/**
 * What to credit somebody with when they have no profile.
 *
 * A person assigned to teach who has never opened their profile screen still
 * has to be credited: the alternative is a course page that names nobody because
 * somebody did not fill in a form. The generic word is the last resort, used when
 * this service holds no name for them at all.
 */
const UNNAMED = 'Instructor';

/** The name to credit for a membership row, for somebody with no profile. */
function nameForMember(member: SpaceMember): string {
  return nameFromEmail(member.email) ?? UNNAMED;
}

export interface InstructorWithCourses {
  instructor: PublicInstructor;
  /** The listed courses they teach, in the order they joined them. */
  spaces: Space[];
}

/**
 * A course's instructors, in the order they were put on it.
 *
 * Every active member holding the instructor role: the role *is* the
 * assignment, so there is no second list to keep in step with the roster — the
 * thing an author does to credit somebody is the thing they already do to let
 * them run the course.
 */
export async function listSpaceInstructors(spaceId: string): Promise<PublicInstructor[]> {
  const members = await listActiveInstructors(spaceId);
  if (members.length === 0) return [];

  const profiles = await batchGetProfiles(members.map((member) => member.userId));

  return Promise.all(
    members.map((member) =>
      toPublicInstructor(member.userId, profiles.get(member.userId), nameForMember(member)),
    ),
  );
}

/**
 * The listed courses one person teaches, newest membership first.
 *
 * Only what is on the marketplace: a public page may not become a way of
 * enumerating somebody's private courses, and a course nobody can open is not
 * something a visitor can be sent to. The reverse index is the roster's own —
 * "every course this person is in" — filtered to the instructor rows here
 * because a role is not part of that key.
 *
 * Not paged. A person teaches a handful of courses, and the ones that are
 * unlisted or already read fall away; the day somebody teaches two hundred of
 * them, this is where a limit belongs.
 */
export async function listListedSpacesTaughtBy(userId: string): Promise<Space[]> {
  const memberships = (await listSpaceMembershipsForUser(userId)).filter(
    (member) => member.role === 'INSTRUCTOR',
  );
  if (memberships.length === 0) return [];

  const rows = await batchGetItems<Space>(
    // The membership names the course; the row itself is what says whether it is
    // published, and a batch read is one round trip rather than one per course.
    SPACES_TABLE,
    memberships.map((member) => ({ spaceId: member.spaceId })),
  );

  const byId = new Map(rows.map((space) => [space.spaceId, space]));
  const listed: Space[] = [];
  for (const membership of memberships) {
    const space = byId.get(membership.spaceId);
    if (space?.listed) listed.push(space);
  }

  return listed;
}

/**
 * One instructor's public page: who they are, and what they teach here.
 *
 * A page about people who teach, and only about them: somebody who has an
 * account and takes courses has no page here, and asking for one is a 404 —
 * the same answer the catalog gives for a course nobody listed. Without that,
 * any id that appears anywhere in the product would resolve to a face, a
 * sentence and a set of links the person never published as a teacher.
 */
export async function getInstructorWithCourses(
  userId: string,
): Promise<InstructorWithCourses | undefined> {
  const memberships = await listSpaceMembershipsForUser(userId);

  const teaching = memberships.filter((member) => member.role === 'INSTRUCTOR');
  if (teaching.length === 0) return undefined;

  const profile = await getProfile(userId);

  // The address on a membership row is the only name this service holds for
  // somebody who has never opened their profile, and the row is only worth
  // reading for it when there is no profile to read instead.
  const fallback = nameForMember(teaching[0]!);

  const rows = await batchGetItems<Space>(
    SPACES_TABLE,
    teaching.map((member) => ({ spaceId: member.spaceId })),
  );
  const byId = new Map(rows.map((space) => [space.spaceId, space]));

  // A course read by id does not come back in the order it was asked for, and
  // the order that means something here is when they started teaching it.
  const spaces = teaching
    .map((member) => byId.get(member.spaceId))
    .filter((space): space is Space => Boolean(space?.listed));

  return {
    instructor: await toPublicInstructor(userId, profile, fallback),
    spaces,
  };
}
