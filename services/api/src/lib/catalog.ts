import { countContentsInSpace } from './contents';
import { batchGetOrganizationsById } from './organizations';
import { countSectionsInSpace } from './sections';
import { countSpaceStudents } from './space-members';
import { buildSpaceThumbnailUrl } from './space-thumbnail';
import { getSpace, listListedSpaces } from './spaces';
import type { CatalogCourse, CatalogLesson, CatalogSection, Content, ContentType, Space } from '../types';

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
      ? {
          thumbnailUrl: (
            await buildSpaceThumbnailUrl({
              spaceId: space.spaceId,
              thumbnailKey: space.thumbnailKey,
            })
          ).thumbnailUrl,
        }
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
  contentsBySection: Map<
    string,
    { contentId: string; title: string; videoId?: string; type?: ContentType }[]
  >,
): CatalogSection[] {
  return sections.map((section) => ({
    sectionId: section.sectionId,
    title: section.title,
    lessons: (contentsBySection.get(section.sectionId) ?? []).map(
      (content): CatalogLesson => ({
        contentId: content.contentId,
        title: content.title,
        hasVideo: Boolean(content.videoId),
        // The kind travels so a syllabus can say a row is a quiz rather than
        // leaving a reader to click it and find out — and so that "3 lessons"
        // is not said over a section holding two lessons and a quiz.
        ...(content.type === 'QUIZ' ? { type: content.type } : {}),
      }),
    ),
  }));
}

/**
 * A lesson list per section, from one pass over a course's contents.
 *
 * The outline is read as one query for the whole course and then grouped here,
 * rather than queried per section: a five-section course would otherwise be five
 * round trips to draw one page.
 */
export function groupContentsBySection(contents: Content[]): Map<string, Content[]> {
  const bySection = new Map<string, Content[]>();
  for (const content of contents) {
    const existing = bySection.get(content.sectionId);
    if (existing) existing.push(content);
    else bySection.set(content.sectionId, [content]);
  }
  return bySection;
}

/**
 * How many published courses one search looks at.
 *
 * A search cannot be answered by a key lookup: DynamoDB has no `contains`, and
 * nothing here is a search index. So a search reads the catalog — which is only
 * the courses their authors published, not every course in the service — and
 * filters in the handler. The cap is what stops "a" from reading the whole
 * table: past this many courses, a catalog wants a real search index rather
 * than a longer loop, and the response says so by simply returning fewer.
 */
const SEARCH_SCAN_LIMIT = 200;

/** How much of the catalog one read takes while searching. */
const SEARCH_PAGE_SIZE = 100;

/**
 * Listed courses matching a search, newest first.
 *
 * Matching is a case-insensitive substring over what a card shows — the course's
 * title, its description, and the name of the community it is from — because
 * those are the three things somebody can see to search by. It is deliberately
 * not fuzzy: "film" matches "Film Studies" and "Filmmaking", and "flm" matches
 * nothing, which is what a search box on a small catalog should do before
 * somebody reaches for an index.
 */
export async function searchListedSpaces(query: string, limit: number): Promise<Space[]> {
  const needle = query.trim().replace(/\s+/g, ' ').toLowerCase();
  const matches: Space[] = [];

  let exclusiveStartKey: Record<string, unknown> | undefined;
  let scanned = 0;

  do {
    const page = await listListedSpaces({ limit: SEARCH_PAGE_SIZE, exclusiveStartKey });
    scanned += page.spaces.length;

    // The community's name is what the card shows under the title, so it is part
    // of what people search by — and it takes one batch read per page rather
    // than one per course.
    const organizations = await batchGetOrganizationsById([
      ...new Set(page.spaces.map((space) => space.organizationId)),
    ]);

    for (const space of page.spaces) {
      const organizationName = organizations.get(space.organizationId)?.name ?? '';
      if (matchesQuery(space, organizationName, needle)) matches.push(space);
    }

    exclusiveStartKey = page.lastEvaluatedKey;
  } while (exclusiveStartKey && matches.length < limit && scanned < SEARCH_SCAN_LIMIT);

  return matches.slice(0, limit);
}

/** Whether a course is one somebody searching for these words would mean. */
function matchesQuery(space: Space, organizationName: string, needle: string): boolean {
  return (
    space.title.toLowerCase().includes(needle) ||
    space.description.toLowerCase().includes(needle) ||
    organizationName.toLowerCase().includes(needle)
  );
}
