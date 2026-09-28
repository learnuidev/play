import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok } from '../../lib/http';
import { ensureProfile, toProfile, updateProfile } from '../../lib/profiles';
import { SOCIAL_KEYS } from '../../types';
import type { ProfileSocials, SocialKey } from '../../types';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_BIO_LENGTH = 500;
const MAX_LINK_LENGTH = 200;

interface UpdateProfileBody {
  name?: unknown;
  bio?: unknown;
  socials?: unknown;
}

/**
 * Edits the caller's own profile.
 *
 * Every field is optional and only what is present is written, so a form that
 * changes one thing does not have to send the rest back — and two tabs editing
 * different fields cannot undo each other.
 *
 * `name` is the one field that is not merely cosmetic: it is what a marketplace
 * course page credits and what an invitation email signs. It is still the
 * person's own to choose — that is the whole point of the row — so it is
 * validated for length and shape and never for content.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const body = jsonBody<UpdateProfileBody>(event);

  // Read first, so the account is named before anything edits it: an update is
  // conditional on the row existing, and a person who saved their bio the second
  // they signed in should not lose it to a missing profile.
  await ensureProfile(user);

  const patch: Parameters<typeof updateProfile>[1] = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') throw new HttpError(400, 'name must be a string');

    const name = body.name.trim().replace(/\s+/g, ' ');
    if (name.length < MIN_NAME_LENGTH) {
      throw new HttpError(400, `name must be at least ${MIN_NAME_LENGTH} characters`);
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new HttpError(400, `name must be <= ${MAX_NAME_LENGTH} characters`);
    }
    patch.name = name;
  }

  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string') throw new HttpError(400, 'bio must be a string');
    const bio = body.bio.trim();
    if (bio.length > MAX_BIO_LENGTH) {
      throw new HttpError(400, `bio must be <= ${MAX_BIO_LENGTH} characters`);
    }
    patch.bio = bio;
  }

  if (body.socials !== undefined) {
    patch.socials = parseSocials(body.socials);
  }

  await updateProfile(user.userId, patch);

  const updated = await ensureProfile(user);
  return ok({ profile: await toProfile(updated) });
}

/**
 * The links, as a whole object rather than one field at a time.
 *
 * Sent whole because that is what the form holds: a person adds a link and
 * clears another, and a request that named only what changed would need the
 * client to know what the server already had. A key sent empty is removed here
 * rather than stored as an empty string, so a profile with one link stores one.
 *
 * An absolute `http(s)` URL and nothing else. A handle is a thing each platform
 * spells differently — `@annaruiz`, `annaruiz`, `in/annaruiz` — and guessing
 * which one somebody meant would put a link on their profile that goes somewhere
 * they did not choose. The form asks for the whole URL and says so.
 */
function parseSocials(raw: unknown): ProfileSocials {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError(400, 'socials must be an object');
  }

  const socials: ProfileSocials = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SOCIAL_KEYS.includes(key as SocialKey)) {
      throw new HttpError(400, `socials.${key} is not one of ${SOCIAL_KEYS.join(', ')}`);
    }
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'string') throw new HttpError(400, `socials.${key} must be a URL string`);

    const url = value.trim();
    if (!url) continue;
    if (url.length > MAX_LINK_LENGTH) {
      throw new HttpError(400, `socials.${key} must be <= ${MAX_LINK_LENGTH} characters`);
    }
    if (!isAbsoluteUrl(url)) {
      throw new HttpError(400, `socials.${key} must be a full URL, e.g. https://x.com/you`);
    }

    socials[key as SocialKey] = url;
  }

  return socials;
}

/** `https://…` only: a bare host is a string that looks like a link and is not one. */
function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const handler = handle(main);
