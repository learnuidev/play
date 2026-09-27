import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging } from '../../lib/http';
import { listPlaylist, resolvePlaylist } from '../../lib/playlist';

/** The caller's learning playlist, most recently added first. */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const { items, lastEvaluatedKey } = await listPlaylist(userId, parsePaging(event));

  return ok({
    items: await resolvePlaylist(items),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
