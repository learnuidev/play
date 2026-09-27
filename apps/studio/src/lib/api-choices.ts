import { api } from '@play/api';
import type { ApiChoiceSource } from './api-reference';

/**
 * The lists behind the pickers on the API reference.
 *
 * An id is the one thing a reader cannot work out from the reference: the card
 * says `contentId` is a lesson, and nothing on the page says which lesson. So a
 * field that names something gets a list of the real ones beside it.
 *
 * These are read with the **signed-in session**, not with the key the playground
 * is holding, and that is deliberate. The picker's job is to answer "which
 * course did I mean", and the courses somebody has are the ones they may edit —
 * including the drafts a key never sees, and including the case where no key has
 * been made yet at all. A key would answer a different question: what that key
 * reaches. A value picked here that the key cannot read is refused with the same
 * 403 a typed one would be, which is a fact about the key worth learning from
 * the response rather than from the list.
 *
 * Every read is bounded. A menu is a glance, not a crawl: the caps below are
 * what keeps opening one from turning into a hundred requests, and they are
 * generous enough that nobody with a normal-sized account will meet them.
 */

/**
 * One thing a field could be set to.
 *
 * `label` is what the reader recognizes it by and `detail` is where it sits —
 * a lesson's course and section, a key's prefix — because two courses can hold a
 * lesson with the same title and a list that showed only titles would make the
 * choice a coin toss.
 */
export interface ApiChoice {
  value: string;
  label: string;
  detail?: string;
}

/**
 * What the page already knows, for a list that is narrower than "everything you
 * have" — which is the point of most of these lists. A lesson belongs to a
 * course, an organization's keys belong to that organization, and a key made for
 * an organization reaches that organization and nothing else.
 */
export interface ChoiceScope {
  /** The course the card names, when it names one. */
  spaceId?: string;
  /** The organization the card names, when it names one. */
  orgId?: string;
  /**
   * The organization the playground's key was made for, when it was made for
   * one.
   *
   * This is the one scope that comes from the credential rather than from the
   * card, and it is the strictest: such a key reaches exactly one organization,
   * so offering the courses and lessons of any other would be offering values
   * that can only come back as a refusal. The reader still sees why the list is
   * short — `keyOrgName` is the same fact, spelled for the menu.
   */
  keyOrgId?: string;
  keyOrgName?: string;
}

/** What a picker is offering, as the menu names it. */
export const API_CHOICE_TITLES: Record<ApiChoiceSource, string> = {
  courses: 'Courses you can read',
  lessons: 'Lessons in your courses',
  organizations: 'Your organizations',
  keys: 'Your API keys',
};

/** How many courses one menu will list. */
const COURSE_LIMIT = 50;

/** How many lessons. A course can hold hundreds; the menu does not need them all. */
const LESSON_LIMIT = 100;

/**
 * How many organizations are asked for their courses.
 *
 * Each one is a request, and somebody in a dozen organizations does not need the
 * twelfth one's courses in a picker for one request.
 */
const ORG_LIMIT = 10;

/**
 * How many courses have their outlines read when a lesson picker has no course
 * to go on.
 *
 * The lesson fields on their own cards take a course id as readily as anything
 * else, but a reader who has not typed one still wants to pick a real lesson —
 * so the first few outlines are read instead of asking them to go and find a
 * course first.
 */
const LESSON_SCAN = 6;

async function organizationChoices(): Promise<ApiChoice[]> {
  const { organizations } = await api.listOrganizations();
  return organizations.slice(0, ORG_LIMIT).map((organization) => ({
    value: organization.orgId,
    label: organization.name,
    detail: organization.role.toLowerCase(),
  }));
}

/**
 * Every course the reader can open — or, under a key made for an organization,
 * every course that organization owns.
 *
 * The scoped case is one request and the honest list: the courses the key will
 * actually answer for, rather than every course the reader could name and the
 * key would then refuse. It is also the wider list in the way that matters,
 * because an organization's courses include the ones nobody has published.
 *
 * The unscoped case is two reads, because a course reaches somebody two ways:
 * their organizations own it, and they may be in one from an organization they
 * have nothing else to do with, which is what `/me/spaces` is for. A course that
 * arrives both ways is one course.
 *
 * An organization whose course list is refused (a viewer, or a role that reads
 * the organization and not its work) is skipped rather than failing the menu:
 * the reader asked what they could pick, and the courses they do have are the
 * answer.
 */
async function courseChoices(scope: ChoiceScope): Promise<ApiChoice[]> {
  if (scope.keyOrgId) {
    const { spaces } = await api.listSpaces(scope.keyOrgId);
    return spaces.slice(0, COURSE_LIMIT).map((space) => ({
      value: space.spaceId,
      label: space.title,
    }));
  }

  const [organizations, mine] = await Promise.allSettled([
    api.listOrganizations(),
    api.listMyCourses(),
  ]);

  // With both refused there is nothing to show and no way to tell "you have no
  // courses" from "we could not look", so the menu says what went wrong.
  if (organizations.status === 'rejected' && mine.status === 'rejected') {
    throw organizations.reason;
  }

  const choices = new Map<string, ApiChoice>();

  const owned = organizations.status === 'fulfilled' ? organizations.value.organizations.slice(0, ORG_LIMIT) : [];
  const outlines = await Promise.allSettled(owned.map((organization) => api.listSpaces(organization.orgId)));

  owned.forEach((organization, index) => {
    const outline = outlines[index];
    if (outline.status !== 'fulfilled') return;
    for (const space of outline.value.spaces) {
      choices.set(space.spaceId, {
        value: space.spaceId,
        label: space.title,
        detail: organization.name,
      });
    }
  });

  if (mine.status === 'fulfilled') {
    for (const { space, organizationName } of mine.value.courses) {
      if (choices.has(space.spaceId)) continue;
      choices.set(space.spaceId, {
        value: space.spaceId,
        label: space.title,
        detail: organizationName,
      });
    }
  }

  return [...choices.values()].slice(0, COURSE_LIMIT);
}

/** The lessons of one course, named by the section they are filed under. */
async function lessonsOf(spaceId: string, courseTitle?: string): Promise<ApiChoice[]> {
  const { sections } = await api.listSections(spaceId);
  return sections.flatMap((section) =>
    section.contents.map((content) => ({
      value: content.contentId,
      label: content.title,
      // With one course in play its title is the same on every row and says
      // nothing; with several, it is the only thing that tells them apart.
      detail: courseTitle ? `${courseTitle} · ${section.title}` : section.title,
    })),
  );
}

async function lessonChoices(scope: ChoiceScope): Promise<ApiChoice[]> {
  const course = scope.spaceId?.trim();
  if (course) return (await lessonsOf(course)).slice(0, LESSON_LIMIT);

  const scanned = (await courseChoices(scope)).slice(0, LESSON_SCAN);
  const outlines = await Promise.allSettled(
    scanned.map((choice) => lessonsOf(choice.value, choice.label)),
  );

  return outlines
    .flatMap((outline) => (outline.status === 'fulfilled' ? outline.value : []))
    .slice(0, LESSON_LIMIT);
}

/**
 * The keys the reader can see.
 *
 * Scoped by an organization when the card names one, which is also the only way
 * this list is ever complete: `/me/api-keys` is the keys somebody made
 * themselves, and the keys that reach an organization outlive whoever made them.
 * A caller who is not an admin of that organization is refused, and the menu
 * says so rather than quietly offering their own keys as if they were the same
 * thing.
 */
async function keyChoices(scope: ChoiceScope): Promise<ApiChoice[]> {
  const organization = scope.orgId?.trim();
  const { keys } = organization
    ? await api.listOrganizationApiKeys(organization)
    : await api.listApiKeys();

  return keys.map((key) => ({
    value: key.keyId,
    label: key.name,
    detail: key.prefix,
  }));
}

/** The values one field's picker can offer, read when the menu is opened. */
export async function loadChoices(
  source: ApiChoiceSource,
  scope: ChoiceScope = {},
): Promise<ApiChoice[]> {
  switch (source) {
    case 'courses':
      return courseChoices(scope);
    case 'lessons':
      return lessonChoices(scope);
    case 'organizations':
      return organizationChoices();
    case 'keys':
      return keyChoices(scope);
  }
}
