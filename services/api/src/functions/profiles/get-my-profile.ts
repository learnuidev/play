import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import { ensureProfile, toProfile } from '../../lib/profiles';

/**
 * The caller's own profile.
 *
 * Read rather than created, in the sense that matters to a client: a person who
 * has never opened this screen has no row and still gets an answer — their name
 * as the identity provider gave it, no photo, nothing said about them. The first
 * read is also what brings the row into being, because the name it is created
 * with is derived from claims only this service can see, and a signed-in account
 * with no name is a course page crediting nobody.
 *
 * Nothing here is an authorization: this is the person's own row, keyed by their
 * own `sub`, and there is no id in the request to get wrong.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const profile = await ensureProfile(user);

  return ok({ profile: await toProfile(profile) });
}

export const handler = handle(main);
