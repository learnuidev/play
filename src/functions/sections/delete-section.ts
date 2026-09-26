import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSectionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { listAllContentsBySection, purgeContent } from '../../lib/contents';
import { handle, noContent, pathParam } from '../../lib/http';
import { deleteSectionItem } from '../../lib/sections';

/**
 * Deletes a section, along with the content filed under it.
 *
 * The cascade is deliberate: a section is a heading over its content, so
 * removing it while leaving the content behind would leave pieces of a course
 * with nowhere to be seen. The content is emptied first and the section row
 * last, so a failure part way through leaves a section that still shows what is
 * left of it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const sectionId = pathParam(event, 'sectionId');

  await requireSectionAccess(sectionId, userId, 'write');

  const contents = await listAllContentsBySection(sectionId);
  for (const content of contents) {
    await purgeContent(content);
  }

  await deleteSectionItem(sectionId);

  return noContent();
}

export const handler = handle(main);
