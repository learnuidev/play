import { countContentsInSpace } from './contents';
import { batchGetOrganizationsById } from './organizations';
import { countSectionsInSpace } from './sections';
import { countSpaceStudents } from './space-members';
import { buildSpaceThumbnailUrl } from './space-thumbnail';
import { getSpace } from './spaces';
import type { CatalogCourse, CatalogLesson, CatalogSection, Space } from '../types';

/**
 * What a listed course looks like from the outside.
 *
 * The catalog is read by people who are not members of anything: a visitor who
 * has not signed in, deciding whether a course is worth registering for. So
 * everything here is assembled from what a course *is* — its own row, its
 * organization's name, how many sections, lessons and students it has — and
 * nothing is read from the membership it is about to acquire. Lesson bodies,
 * videos and discussion are deliberately absent: they are what registering for
 * the course gets you.
 */

/**
 * The catalog's view of one course, or nothing when there is no such course or
 * its author has not listed it.
 *
 * Unlisted is 404 rather than 403 for the same reason a missing organization is:
 * the catalog must not tell a stranger which course ids exist in private.
 */
export async function getCatalogCourse(spaceId: string): Promise<CatalogCourse | undefined> {
  const space = await getSpace(spaceId);
  if (!space || !space.listed) return undefined;

  const organizations = await batchGetOrganizationsById([space.organizationId]);
  const organization = organizations.get(space.organizationId);

  return buildCatalogCourse(space, organization?.name ?? 'A community on Play');
}

/** Adds what the counts and the organization's name say to a course row. */
async function buildCatalogCourse(
  space: Space,
  organizationName: string,
): Promise<CatalogCourse> {
  // Three counts, in parallel and per course. Each is one `COUNT` over an index
  // the course already has, and the alternative — counters maintained by hand
  // across section and lesson writes — is a number that drifts out of step with
  // the course it describes.
  const [sectionCount, lessonCount, studentCount] = await Promise.all([
    countSectionsInSpace(space.spaceId),
    countContentsInSpace(space.spaceId),
    countSpaceStudents(space.spaceId),
  ]);

  return {
    spaceId: space.spaceId,
    organizationId: space.organizationId,
    organizationName,
    title: space.title,
    description: space.description,
    type: space.type,
    ...(space.color ? { color: space.color } : {}),
    ...(space.startAt !== undefined ? { startAt: space.startAt } : {}),
    ...(space.dripIntervalDays !== undefined
      ? { dripIntervalDays: space.dripIntervalDays }
      : {}),
    ...(space.thumbnailKey ? { thumbnailKey: space.thumbnailKey } : {}),
    // A signed URL, built here: the cover is behind CloudFront's signature at
    // the storage layer, and the catalog is where a stranger is allowed to see
    // it. Signing per response is what keeps a listed course's cover public
    // without making the object public.
    ...(space.thumbnailKey
      ? { thumbnailUrl: buildSpaceThumbnailUrl({ spaceId: space.spaceId, thumbnailKey: space.thumbnailKey }).thumbnailUrl }
      : {}),
    sectionCount,
    lessonCount,
    studentCount,
    createdAt: space.createdAt,
  };
}

/**
 * A page of listed courses, with the organization names they are from.
 *
 * The names come back in one batch read rather than one per course: a page of
 * twenty courses from six communities is six reads, not twenty.
 */
export async function toCatalogCourses(spaces: Space[]): Promise<CatalogCourse[]> {
  const organizationIds = [...new Set(spaces.map((space) => space.organizationId))];
  const organizations = await batchGetOrganizationsById(organizationIds);

  return Promise.all(
    spaces.map((space) =>
      buildCatalogCourse(space, organizations.get(space.organizationId)?.name ?? 'A community on Play'),
    ),
  );
}

/**
 * A course's outline as anybody may read it: what the sections are called and
 * what lessons they hold.
 *
 * No notes, no attachments, no video ids — a syllabus is what somebody reads
 * before deciding, and the lessons themselves are what they get afterwards.
 */
export function toCatalogSections(
  sections: { sectionId: string; title: string }[],
  contentsBySection: Map<string, { contentId: string; title: string; videoId?: string }[]>,
): CatalogSection[] {
  return sections.map((section) => ({
    sectionId: section.sectionId,
    title: section.title,
    lessons: (contentsBySection.get(section.sectionId) ?? []).map(
      (content): CatalogLesson => ({
        contentId: content.contentId,
        title: content.title,
        hasVideo: Boolean(content.videoId),
      }),
    ),
  }));
}
