import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getCatalogCourse, groupContentsBySection, toCatalogSections } from '../../lib/catalog';
import { listAllContentsBySpace } from '../../lib/contents';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { listSpaceInstructors } from '../../lib/instructors';
import { listAllSectionsBySpace } from '../../lib/sections';

/**
 * One listed course: what it is, who teaches it, and what is in it.
 *
 * The syllabus is public — sections and lesson titles, which is what somebody
 * weighs a course by — while the lessons themselves are not: a lesson's video,
 * notes, files and discussion are what registering for the course is *for*, and
 * they stay behind the membership check the classroom already does.
 *
 * Who teaches it belongs on this side of that line. A course is a person's work
 * before it is a syllabus, the names travel with the course rather than behind
 * registration, and they come back with it rather than from a second request
 * because this is the one page that asks.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const spaceId = pathParam(event, 'spaceId');

  const course = await getCatalogCourse(spaceId);
  if (!course) throw new HttpError(404, 'Course not found');

  const { sections } = await listAllSectionsBySpace(spaceId);
  const { contents } = await listAllContentsBySpace(spaceId);

  return ok({
    course,
    sections: toCatalogSections(sections, groupContentsBySection(contents)),
    instructors: await listSpaceInstructors(spaceId),
  });
}

export const handler = handle(main);
