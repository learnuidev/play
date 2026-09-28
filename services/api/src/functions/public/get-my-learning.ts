import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireApiCaller } from '../../lib/auth';
import { listCompletionsForUser } from '../../lib/completions';
import { CONTENTS_TABLE } from '../../lib/contents';
import { batchGetItems } from '../../lib/dynamodb';
import { listAllFavourites } from '../../lib/favourites';
import { handle, ok } from '../../lib/http';
import { requireScope } from '../../lib/oauth-scopes';
import { SPACES_TABLE } from '../../lib/spaces';
import type { ApiCompletion, ApiFavouriteLesson, ApiLearningResponse, Content, Space } from '../../types';

/**
 * The caller's own learning record: what they have saved, and what they have
 * finished.
 *
 * The read that makes the two write scopes worth asking for. An app that can mark
 * a lesson complete but cannot see which lessons are already complete draws a
 * checkbox that lies; the same goes for a heart. So this answers both questions,
 * for the whole record, in one response — a classroom puts a tick and a save
 * beside every lesson in its outline, and doing that a lesson at a time would be
 * one request per row on the page.
 *
 * Two lists rather than two routes, and the `favourites` half is the "list my
 * saved lessons" the API did not have before. What it deliberately leaves out is
 * the *other* things a person can save in Play: hearts on comments and on loops.
 * Those are gestures made while reading a discussion, and an app that shows a
 * course has no use for them.
 *
 * Both lists are read to the end rather than paged. They are the person's own
 * activity — bounded by what they have done rather than by what the service
 * holds — and paging somebody through their own history is a page that has to
 * explain an index to a reader who just wants their list.
 *
 * Behind `learning:read`, which is separate from `learning:write` on purpose:
 * seeing what somebody has saved is not the same permission as changing it, and
 * a consent screen that offered them as one sentence would be offering more than
 * it said.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = await requireApiCaller(event);
  requireScope(caller, 'learning:read');

  const [favourites, completions] = await Promise.all([
    listAllFavourites(caller.userId, 'CONTENT'),
    listCompletionsForUser(caller.userId),
  ]);

  const contentIds = [
    ...new Set([...favourites.map((favourite) => favourite.targetId), ...completions.map((c) => c.contentId)]),
  ];

  // Two batch reads for the whole response, whatever its length, and they are
  // sequential rather than parallel because the second depends on the first: a
  // favourite carries a lesson id and no course, so which courses to read is
  // only known once the lessons have arrived. A list of saved lessons that never
  // says which course any of them is in is a list somebody has to open five
  // links to read.
  const contents = contentIds.length
    ? await batchGetItems<Content>(CONTENTS_TABLE, contentIds.map((contentId) => ({ contentId })))
    : [];

  const spaceIds = [
    ...new Set([...contents.map((content) => content.spaceId), ...completions.map((c) => c.spaceId)]),
  ];
  const spaces = spaceIds.length
    ? await batchGetItems<Space>(SPACES_TABLE, spaceIds.map((spaceId) => ({ spaceId })))
    : [];

  const contentsById = new Map(contents.map((content) => [content.contentId, content]));
  const spacesById = new Map(spaces.map((space) => [space.spaceId, space]));

  const body: ApiLearningResponse = {
    favourites: favourites.flatMap((favourite): ApiFavouriteLesson[] => {
      const content = contentsById.get(favourite.targetId);
      // A favourite whose lesson has since been deleted is dropped rather than
      // reported as broken, which is what Play's own list does with the same row.
      if (!content) return [];

      return [
        {
          contentId: content.contentId,
          title: content.title,
          spaceId: content.spaceId,
          spaceTitle: spacesById.get(content.spaceId)?.title ?? 'A course',
          position: content.position,
          hasVideo: Boolean(content.videoId),
          favouritedAt: favourite.createdAt,
        },
      ];
    }),
    completed: completions.flatMap((completion): ApiCompletion[] =>
      contentsById.has(completion.contentId)
        ? [
            {
              contentId: completion.contentId,
              spaceId: completion.spaceId,
              completedAt: completion.completedAt,
            },
          ]
        : [],
    ),
  };

  return ok(body);
}

export const handler = handle(main);
