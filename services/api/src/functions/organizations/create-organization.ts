import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';
import { buildSlug, createOrganization } from '../../lib/organizations';
import type { OrgMember, Organization, OrganizationSummary } from '../../types';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

interface CreateOrganizationBody {
  name?: string;
  description?: string;
}

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  let body: CreateOrganizationBody = {};
  try {
    body = (event.body ? JSON.parse(event.body) : {}) as CreateOrganizationBody;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }

  const name = (body.name ?? '').trim().replace(/\s+/g, ' ');
  const description = (body.description ?? '').trim();

  if (!name) throw new HttpError(400, 'name is required');
  if (name.length < MIN_NAME_LENGTH) {
    throw new HttpError(400, `name must be at least ${MIN_NAME_LENGTH} characters`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `name must be <= ${MAX_NAME_LENGTH} characters`);
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(400, `description must be <= ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  const orgId = ulid();
  // The tail of the ULID is its random half, so it doubles as the slug suffix
  // that keeps two organizations with the same name apart.
  const suffix = orgId.slice(-6).toLowerCase();
  const now = Date.now();

  const organization: Organization = {
    orgId,
    name,
    slug: buildSlug(name, suffix),
    description,
    ownerId: user.userId,
    // The creator is the organization's first admin, and the count moves in
    // step with every later invitation, promotion, demotion and removal.
    adminCount: 1,
    createdAt: now,
    updatedAt: now,
  };

  // The creator is the organization's first admin. Inviting others is a
  // separate flow, but it writes the same membership shape.
  const ownerMember: OrgMember = {
    orgId,
    userId: user.userId,
    role: 'ADMIN',
    status: 'ACTIVE',
    ...(user.email ? { email: user.email } : {}),
    invitedBy: user.userId,
    joinedAt: now,
  };

  await createOrganization(organization, ownerMember);

  const summary: OrganizationSummary = { ...organization, role: ownerMember.role };
  return ok({ organization: summary }, 201);
}

export const handler = handle(main);
