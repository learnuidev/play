import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess, requireSectionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getContent, placeContent } from '../../lib/contents';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';

interface PlaceContentBody {
  /** The section it lands in. Absent means the one it is already in. */
  sectionId?: unknown;
  /** Zero-based place in that section's content, counting from the top. */
  index?: unknown;
}

/**
 * Moves a lesson or a quiz to where an author dropped it.
 *
 * Two writes are hidden behind this one request, and both are why it is a route
 * of its own rather than a position on the content patch:
 *
 * - **the order is the section's.** Dropping a lesson third from the top of a
 *   forty-lesson section renumbers everything after it, and the client cannot
 *   compute that — it drew a list that may already be out of date, and an index
 *   ("third") stays true where a position ("37") does not;
 * - **a drop can cross sections.** A lesson dragged from "Week 1" into "Week 2"
 *   is a change of section *and* of place, which no single field on the content
 *   can express.
 *
 * It answers with the outline rather than with the moved row, because both
 * sections have changed: the one it left, and the one it arrived in.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const content = await requireContentAccess(contentId, userId, 'write');
  const body = jsonBody<PlaceContentBody>(event);

  if (typeof body.index !== 'number' || !Number.isInteger(body.index) || body.index < 0) {
    throw new HttpError(400, 'index must be a whole number >= 0');
  }

  let sectionId = content.sectionId;

  if (body.sectionId !== undefined) {
    if (typeof body.sectionId !== 'string' || !body.sectionId.trim()) {
      throw new HttpError(400, 'sectionId must be a section id');
    }

    const section = await requireSectionAccess(body.sectionId.trim(), userId, 'write');
    // A course's content lives in that course's sections, and a drop into
    // another course's section would move a lesson out of the course that owns
    // it while leaving its `spaceId` behind.
    if (section.spaceId !== content.spaceId) {
      throw new HttpError(400, 'Content can only be moved between sections of its own course');
    }
    sectionId = section.sectionId;
  }

  await placeContent(content, { sectionId, index: body.index });

  return ok({ content: await getContent(contentId) });
}

export const handler = handle(main);
