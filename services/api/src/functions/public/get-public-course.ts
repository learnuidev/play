import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireApiKeyCaller } from '../../lib/auth';
import { getCatalogCourse, toCatalogSections } from '../../lib/catalog';
import { listAllContentsBySpace } from '../../lib/contents';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { listAllSectionsBySpace } from '../../lib/sections';
import type { Content } from '../../types';

/**
 * One published course and its syllabus, to a key.
 *
 * Listed courses only, and the same answer the marketplace's own course page
 * gets: a key reaches what a course says about itself in public, and a private
 * course answers 404 rather than 403 so that the catalog does not report which
 * course ids exist behind it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  requireApiKeyCaller(event);

  const spaceId = pathParam(event, 'spaceId');

  const course = await getCatalogCourse(spaceId);
  if (!course) throw new HttpError(404, 'Course not found');

  const { sections } = await listAllSectionsBySpace(spaceId);
  const { contents } = await listAllContentsBySpace(spaceId);

  return ok({ course, sections: toCatalogSections(sections, groupBySection(contents)) });
}

/** A lesson list per section, from one pass over the course's contents. */
function groupBySection(contents: Content[]): Map<string, Content[]> {
  const bySection = new Map<string, Content[]>();
  for (const content of contents) {
    const existing = bySection.get(content.sectionId);
    if (existing) existing.push(content);
    else bySection.set(content.sectionId, [content]);
  }
  return bySection;
}

export const handler = handle(main);
