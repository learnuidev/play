import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSectionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import { getSection, updateSection, type UpdateSectionPatch } from '../../lib/sections';
import { parsePosition, parseText, parseTitle } from '../../lib/validation';

const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

interface UpdateSectionBody {
  title?: unknown;
  description?: unknown;
  position?: unknown;
}

/**
 * Renames a section, rewrites its description, or moves it in the space.
 *
 * Only the fields the request carries are changed, so moving a section does not
 * have to restate its title. An empty patch is answered from the row already
 * read rather than written back.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const sectionId = pathParam(event, 'sectionId');

  const existing = await requireSectionAccess(sectionId, userId, 'write');
  const body = jsonBody<UpdateSectionBody>(event);

  const patch: UpdateSectionPatch = {};
  if (body.title !== undefined) {
    patch.title = parseTitle(body.title, { min: MIN_TITLE_LENGTH, max: MAX_TITLE_LENGTH });
  }
  if (body.description !== undefined) {
    patch.description = parseText(body.description, MAX_DESCRIPTION_LENGTH, 'description');
  }
  if (body.position !== undefined) {
    patch.position = parsePosition(body.position);
  }

  if (Object.keys(patch).length === 0) {
    return ok({ section: existing });
  }

  await updateSection(sectionId, patch);

  return ok({ section: await getSection(sectionId) });
}

export const handler = handle(main);
