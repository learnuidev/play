import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { purgeContent } from '../../lib/contents';
import { handle, noContent, pathParam } from '../../lib/http';

/** Deletes a piece of content, along with its attachments and its comments. */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const content = await requireContentAccess(pathParam(event, 'contentId'), userId, 'write');

  await purgeContent(content);

  return noContent();
}

export const handler = handle(main);
