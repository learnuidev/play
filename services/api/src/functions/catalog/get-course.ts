import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getCatalogCourse, toCatalogSections } from '../../lib/catalog';
import { listAllContentsBySpace } from '../../lib/contents';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { listAllSectionsBySpace } from '../../lib/sections';
import type { Content } from '../../types';

/**
 * One listed course: what it is, and what is in it.
 *
 * The syllabus is public — sections and lesson titles, which is what somebody
 * weighs a course by — while the lessons themselves are not: a lesson's video,
 * notes, files and discussion are what registering for the course is *for*, and
 * they stay behind the membership check the classroom already does.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
