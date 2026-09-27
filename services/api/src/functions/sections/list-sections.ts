import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { listAllContentsBySpace } from '../../lib/contents';
import { handle, ok, pathParam } from '../../lib/http';
import { listAllSectionsBySpace } from '../../lib/sections';
import type { Content, SectionWithContents } from '../../types';

/**
 * A space's outline: its sections in reading order, each with the content filed
 * under it.
 *
 * Sections and content are read in full rather than paged, because an outline
 * is only useful whole — and because reading the space's content in one query
 * and grouping it here means the whole page costs two reads however many
 * sections a course has. Past the ceilings both reads carry, `truncated` says
 * so rather than the page quietly lying.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  await requireSpaceAccess(spaceId, userId, 'read');

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

  return ok({ sections, truncated: sectionPage.truncated || contentPage.truncated });
}

export const handler = handle(main);
