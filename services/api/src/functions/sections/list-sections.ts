import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { readSpaceOutline } from '../../lib/outline';

/**
 * A space's outline: its sections in reading order, each with the content filed
 * under it.
 *
 * Sections and content are read in full rather than paged, because an outline
 * is only useful whole — and because reading the space's content in one query
 * and grouping it in the library means the whole page costs two reads however
 * many sections a course has. Past the ceilings both reads carry, `truncated`
 * says so rather than the page quietly lying.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  await requireSpaceAccess(spaceId, userId, 'read');

  return ok(await readSpaceOutline(spaceId));
}

export const handler = handle(main);
