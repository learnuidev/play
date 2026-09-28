import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireApiCaller } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import { requireScope } from '../../lib/oauth-scopes';
import { getProfile, toPublicInstructor } from '../../lib/profiles';

/**
 * What to call somebody this service has no profile for.
 *
 * The read below deliberately does **not** create the row, which the signed-in
 * route does: naming an account is a one-time write that takes the identity
 * provider's claims, and an OAuth token carries none — so a row created here
 * would pin the name to this placeholder for good. Reading without creating
 * means the person is named properly the first time they open the studio, which
 * is also where they agree to these consents in the first place.
 */
const UNNAMED = 'Play member';

/**
 * The person behind the credential: their name, their face, what they say about
 * themselves, and their links.
 *
 * The endpoint an app calls to be *personalized* rather than merely authorized.
 * An app that knows a name can greet somebody by it, and an app that knows
 * nothing about them can only show them a list of what they are allowed to read
 * — which is the difference between an integration that feels like part of the
 * product and one that feels like a script with a token.
 *
 * Behind `profile:read`, and that is the scope doing the one job a scope can do
 * that a credential cannot: an app that lists a catalog never has to be trusted
 * with somebody's name, and a person reading a consent screen can see the
 * difference between "see your courses" and "see your profile" and refuse one
 * without the other.
 *
 * The shape is the *public* half of a profile — `PublicInstructor`, the same one
 * a course page credits an instructor with. Deliberately: name, sentence, links
 * and a signed photo URL, and no email, no timestamps, and no id beyond the one
 * that was already in the credential. A profile field this service does not show
 * a stranger is not a field an app may read either, whatever the person agreed
 * to, because the consent screen cannot ask them to agree to something they have
 * never been able to see.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = await requireApiCaller(event);
  requireScope(caller, 'profile:read');

  const profile = await getProfile(caller.userId);

  return ok({
    profile: await toPublicInstructor(caller.userId, profile, UNNAMED),
  });
}

export const handler = handle(main);
