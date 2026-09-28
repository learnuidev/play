import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCallerSpaceAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { requireScope } from '../../lib/oauth-scopes';
import { groupContentsBySection, toCatalogSections } from '../../lib/catalog';
import { handle, ok, pathParam } from '../../lib/http';
import { listAllContentsBySpace } from '../../lib/contents';
import { listAllSectionsBySpace } from '../../lib/sections';

/**
 * A course's outline, to a credential that may read it.
 *
 * The shape is the syllabus the public catalogue already serves — sections, and
 * the title and presence of each lesson — with one difference that is the whole
 * reason this route exists: it is authorized by *access* rather than by
 * publication. A course nobody has published is 404 from `GET /v1/courses/{id}`
 * and readable here by the people who can read it, which is what a lesson
 * experience needs: its own left rail, including the courses that are not
 * advertised to the world.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = requireApiCaller(event);
  requireScope(caller, 'lessons:read');

  const spaceId = pathParam(event, 'spaceId');

  await requireCallerSpaceAccess(spaceId, caller);

  const { sections } = await listAllSectionsBySpace(spaceId);
  const { contents } = await listAllContentsBySpace(spaceId);

  return ok({ sections: toCatalogSections(sections, groupContentsBySection(contents)) });
}

export const handler = handle(main);
