import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSectionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { listContentsBySection } from '../../lib/contents';
import { encodeNextToken, handle, ok, parsePaging, pathParam } from '../../lib/http';
/**
 * One section's content, in reading order.
 *
 * The space outline already answers this for the whole course; this is the
 * paged way to read a single section, for a section large enough that the
 * outline's ceiling would have cut it short.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const sectionId = pathParam(event, 'sectionId');

  await requireSectionAccess(sectionId, userId, 'read');

  const { contents, lastEvaluatedKey } = await listContentsBySection(sectionId, parsePaging(event));

  return ok({ contents, nextToken: encodeNextToken(lastEvaluatedKey) });
}

export const handler = handle(main);
