import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireSpaceAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import { nextSectionPosition, putSection } from '../../lib/sections';
import { parsePosition, parseText, parseTitle } from '../../lib/validation';
import type { Section } from '../../types';

const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

interface CreateSectionBody {
  title?: unknown;
  description?: unknown;
  /** Optional explicit order; omitted means "append to the end of the space". */
  position?: unknown;
}

/**
 * Adds a section to a space. A section is where content is published under a
 * heading — the unit a scheduled space drips — so only an admin or editor may
 * create one.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await requireSpaceAccess(spaceId, user.userId, 'write');
  const body = jsonBody<CreateSectionBody>(event);

  const title = parseTitle(body.title, { min: MIN_TITLE_LENGTH, max: MAX_TITLE_LENGTH });
  const description = parseText(body.description, MAX_DESCRIPTION_LENGTH, 'description');
  const position =
    body.position === undefined ? await nextSectionPosition(spaceId) : parsePosition(body.position);

  const now = Date.now();
  const section: Section = {
    sectionId: ulid(),
    spaceId,
    organizationId: space.organizationId,
    title,
    description,
    position,
    createdBy: user.userId,
    createdAt: now,
    updatedAt: now,
  };

  await putSection(section);

  return ok({ section }, 201);
}

export const handler = handle(main);
