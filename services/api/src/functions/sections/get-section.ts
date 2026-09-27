import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSectionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';

/** One section, as the editor needs it before a change is made. */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const section = await requireSectionAccess(pathParam(event, 'sectionId'), userId, 'read');

  return ok({ section });
}

export const handler = handle(main);
