import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';

interface UpdateVideoBody {
  title?: string;
  description?: string;
}

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const existing = await requireVideoAccess(videoId, userId, 'write');

  const body = (event.body ? JSON.parse(event.body) : {}) as UpdateVideoBody;
  const patch: { title?: string; description?: string } = {};

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) throw new HttpError(400, 'title cannot be empty');
    patch.title = title;
  }
  if (body.description !== undefined) {
    patch.description = body.description.trim();
  }

  if (Object.keys(patch).length === 0) {
    return ok({ video: existing });
  }

  await updateVideo(videoId, patch);
  const updated = await getVideo(videoId);

  return ok({ video: updated });
}

export const handler = handle(main);
