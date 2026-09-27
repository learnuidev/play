import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  assertKeyAllowance,
  createApiKey,
  toApiKey,
} from '../../lib/api-keys';
import { requireOrganizationAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok } from '../../lib/http';
import { getOrganization } from '../../lib/organizations';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 60;

interface CreateApiKeyBody {
  name?: string;
  organizationId?: string;
}

/**
 * Makes an API key for the caller, and answers with the secret exactly once.
 *
 * Any signed-in person may make a key: it acts as them, reaching the public
 * catalog and nothing else. Naming an organization is what widens it — a key
 * made for an organization may read that organization's courses, and it is then
 * visible to the organization's admins, who can revoke it without having to ask
 * the person who made it.
 *
 * Naming one is allowed to any active member rather than to admins only. The
 * courses the key would reach are courses every member can already read, and an
 * admin's visibility of the key is a control over the key, not over the member.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const body = jsonBody<CreateApiKeyBody>(event);

  const name = (body.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'name is required');
  if (name.length < MIN_NAME_LENGTH) {
    throw new HttpError(400, `name must be at least ${MIN_NAME_LENGTH} characters`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `name must be <= ${MAX_NAME_LENGTH} characters`);
  }

  let organizationName: string | undefined;
  if (body.organizationId) {
    // Membership is what authorizes it, and the same check every other
    // organization-addressed route makes: a key cannot be made for an
    // organization the caller has nothing to do with.
    await requireOrganizationAccess(user.userId, body.organizationId, 'read');
    organizationName = (await getOrganization(body.organizationId))?.name;
  }

  await assertKeyAllowance(user.userId);

  const { record, secret } = await createApiKey({
    userId: user.userId,
    ...(user.email ? { userEmail: user.email } : {}),
    name,
    ...(body.organizationId ? { organizationId: body.organizationId } : {}),
    ...(organizationName ? { organizationName } : {}),
  });

  return ok({ key: toApiKey(record), secret }, 201);
}

export const handler = handle(main);
