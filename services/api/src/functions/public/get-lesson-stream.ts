import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCallerContentAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { requireScope } from '../../lib/oauth-scopes';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { buildSignedStreamUrl } from '../../lib/cloudfront';
import { getVideo } from '../../lib/dynamodb';

/**
 * How to play a lesson's video.
 *
 * A signed HLS manifest URL — and the query string beside it, because the
 * signature is scoped to the video's stream prefix rather than to one file, so
 * the same query has to be attached to every segment the player asks for. That
 * is the one thing a caller cannot work out from the manifest alone, which is
 * why `signedQuery` and `baseUrl` are part of the answer rather than derived.
 *
 * The URL expires: `expiresAt` is when, in epoch seconds, and a caller holding a
 * page open longer than that refetches this. Nothing here is public — the
 * manifest is signed per request, so a lesson's video is reachable only by
 * somebody who may read the lesson.
 *
 * `lessons:stream` rather than `lessons:read`, and it is the one scope an app
 * has to ask for separately. Listing what a course contains and paying to serve
 * its video are different things to agree to, and an app that indexes a catalog
 * has no business with the second.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = requireApiCaller(event);
  requireScope(caller, 'lessons:stream');

  const content = await requireCallerContentAccess(pathParam(event, 'contentId'), caller);

  if (!content.videoId) {
    throw new HttpError(404, 'This lesson has no video');
  }

  const video = await getVideo(content.videoId);
  if (!video) throw new HttpError(404, 'This lesson has no video');

  // Still encoding, or failed: a 409 with the status says which, where an empty
  // manifest URL would leave a player showing an error it cannot explain.
  if (video.status !== 'READY' || !video.manifestKey) {
    throw new HttpError(409, `This lesson's video is not ready to play (status: ${video.status})`);
  }

  const stream = await buildSignedStreamUrl(video.manifestKey);
  return ok({ ...stream, videoId: video.videoId });
}

export const handler = handle(main);
