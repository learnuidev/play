import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getCompletion } from '../../lib/completions';
import { favouriteTargetKey, isFavourited } from '../../lib/favourites';
import { handle, ok, pathParam } from '../../lib/http';
import { isInPlaylist } from '../../lib/playlist';
import type { ContentViewerState } from '../../types';

/**
 * One piece of content, together with what the caller themselves has done with
 * it.
 *
 * The learner's own state rides along rather than living behind its own
 * endpoint: a content page always needs it, it is two key lookups either way,
 * and fetching it separately would mean the page renders a favourite button in
 * the wrong state first.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const content = await requireContentAccess(pathParam(event, 'contentId'), userId, 'read');

  const [favourited, inPlaylist, completion] = await Promise.all([
    isFavourited(userId, favouriteTargetKey('CONTENT', content.contentId)),
    isInPlaylist(userId, content.contentId),
    getCompletion(userId, content.spaceId, content.contentId),
  ]);

  const viewer: ContentViewerState = {
    favourited,
    inPlaylist,
    completed: Boolean(completion),
  };

  return ok({ content, viewer });
}

export const handler = handle(main);
