import { listAllContentsBySpace } from './contents';
import { listAllSectionsBySpace } from './sections';
import type { Content, SectionWithContents } from '../types';

/** A space's sections in reading order, each with the content filed under it. */
export interface SpaceOutline {
  sections: SectionWithContents[];
  /** True when either read hit its ceiling, so the outline is not the whole. */
  truncated: boolean;
}

/**
 * Reads a space's outline whole: its sections, and the content under each.
 *
 * Two reads however many sections a course has, because the space's content is
 * fetched in one query and grouped here rather than queried section by section.
 *
 * It lives in the library rather than in the endpoint that first needed it
 * because the order a learner meets a course in is one question: the page that
 * lists the outline and the card that opens the lesson somebody is up to must
 * agree on what "first" means, or a course's first lesson is two different
 * lessons depending on where it is read.
 */
export async function readSpaceOutline(spaceId: string): Promise<SpaceOutline> {
  const [sectionPage, contentPage] = await Promise.all([
    listAllSectionsBySpace(spaceId),
    listAllContentsBySpace(spaceId),
  ]);

  const contentsBySection = new Map<string, Content[]>();
  for (const content of contentPage.contents) {
    const list = contentsBySection.get(content.sectionId);
    if (list) list.push(content);
    else contentsBySection.set(content.sectionId, [content]);
  }

  // A space's contents come back ordered by position, but that order is per
  // section, so each section's own slice is sorted explicitly.
  const sections: SectionWithContents[] = sectionPage.sections.map((section) => ({
    ...section,
    contents: (contentsBySection.get(section.sectionId) ?? []).sort((a, b) => a.position - b.position),
  }));

  return { sections, truncated: sectionPage.truncated || contentPage.truncated };
}
