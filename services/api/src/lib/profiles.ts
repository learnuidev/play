import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ProfileRow, ProfileSocials, PublicInstructor } from '../types';
import type { AuthUser } from './auth';
import { env } from './config';
import { batchGetItems, documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { buildProfilePhotoUrl } from './profile-photo';

export const PROFILES_TABLE = env.profilesTableName;

/**
 * The people who belong to this product, as opposed to the identities they sign
 * in with.
 *
 * Everything else in this service keys a person by their Cognito `sub` and never
 * needs to say their name: a membership is a relationship, a completion is a
 * row, a key is a credential. The two places that do need it — a marketplace
 * course page that credits somebody, and a studio roster that lists them — were
 * reading an email address or the first six characters of a `sub`, which is a
 * name only in the sense that it is unique.
 *
 * So this is the row a person edits about themselves. It is deliberately not a
 * Cognito attribute: a pool attribute is written by whoever federated the
 * sign-in (Google fills `name`, an email address does not), it needs
 * `cognito-idp` on the shared Lambda role to change, and it is not ours to
 * version. A row keyed by `sub` is the same identity everything else already
 * uses, and it is the one thing a person is allowed to rewrite.
 */

/** The longest name this API will store, matching the form's own limit. */
const MAX_NAME_LENGTH = 80;

/** How much of an address's local part becomes a name. Long enough for anything real. */
const MAX_DERIVED_NAME_LENGTH = 60;

/**
 * What to call somebody who has not named themselves yet.
 *
 * The identity provider's `name` claim when it carries one — Google does, a
 * password account does not — and otherwise the part of their address before the
 * `@`, spaced out: `anna.ruiz@example.com` is "Anna Ruiz" to anybody reading it,
 * and it is the only human-readable thing this service holds about a person who
 * has never opened their profile. The address itself is never shown: it is not
 * ours to publish, and a course page crediting `anna.ruiz@example.com` would be
 * publishing it.
 */
export function defaultProfileName(user: AuthUser): string {
  const claimed = user.name?.trim();
  if (claimed) return claimed.slice(0, MAX_NAME_LENGTH);

  return nameFromEmail(user.email) ?? 'Play member';
}

/**
 * The human-readable part of an address, when there is one.
 *
 * Exported because a name is also needed for people this service can only see
 * through a membership row — somebody assigned to teach a course who has never
 * opened their profile has an address on that row and nothing else. Undefined
 * rather than a guess when there is no address: the caller decides what to fall
 * back to, and "no name" is a different answer from "somebody".
 */
export function nameFromEmail(email: string | undefined): string | undefined {
  const local = email?.split('@')[0]?.trim();
  if (!local) return undefined;
  return humanize(local);
}

/** `anna.ruiz` → `Anna Ruiz`. Anything unrecognizable is left as the fallback. */
function humanize(local: string): string {
  const words = local
    .split(/[._\-+]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1));

  return words.join(' ').slice(0, MAX_DERIVED_NAME_LENGTH) || 'Play member';
}

/** The name to credit somebody with, from a stored row or from a stand-in. */
export function nameOf(profile: ProfileRow | undefined, fallback: string): string {
  const stored = profile?.name?.trim();
  return stored || fallback;
}

export async function getProfile(userId: string): Promise<ProfileRow | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: PROFILES_TABLE, Key: { userId } }),
  );
  return res.Item as ProfileRow | undefined;
}

/**
 * Writes a profile, but never over one that exists.
 *
 * Used by the read below, where the point is to name an account once — a
 * `PutItem` that could overwrite would turn a stale request into a screen that
 * undoes somebody's name.
 */
export async function putProfileIfAbsent(profile: ProfileRow): Promise<void> {
  try {
    await client.send(
      new PutCommand({
        TableName: PROFILES_TABLE,
        Item: profile,
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    );
  } catch (err) {
    // Somebody else's request named this account first, which is the same
    // outcome: the row now exists and the caller is about to read it.
    if (!isConditionalCheckFailed(err)) throw err;
  }
}

export interface ProfilePatch {
  name?: string;
  bio?: string;
  socials?: ProfileSocials;
}

/**
 * Edits the parts of a profile a person may change.
 *
 * Nothing is written that was not sent, and `bio`/`socials` sent empty are
 * removed rather than stored as `null` — the rule the space's own patch follows,
 * and the reason a reader never has to tell "absent" from "cleared".
 */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  const now = Date.now();

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': now };
  const set: string[] = ['#updatedAt = :updatedAt'];
  const remove: string[] = [];
  names['#updatedAt'] = 'updatedAt';

  if (patch.name !== undefined) {
    names['#name'] = 'name';
    values[':name'] = patch.name;
    set.push('#name = :name');
  }

  if (patch.bio !== undefined) {
    names['#bio'] = 'bio';
    if (patch.bio) {
      values[':bio'] = patch.bio;
      set.push('#bio = :bio');
    } else {
      remove.push('#bio');
    }
  }

  if (patch.socials !== undefined) {
    names['#socials'] = 'socials';
    if (Object.keys(patch.socials).length > 0) {
      values[':socials'] = patch.socials;
      set.push('#socials = :socials');
    } else {
      remove.push('#socials');
    }
  }

  await client.send(
    new UpdateCommand({
      TableName: PROFILES_TABLE,
      Key: { userId },
      // A profile is created by being read, so it exists by the time anything
      // edits it — a `SET` that matched nothing would answer 200 and change
      // nothing at all.
      ConditionExpression: 'attribute_exists(userId)',
      UpdateExpression: `SET ${set.join(', ')}${remove.length ? ` REMOVE ${remove.join(', ')}` : ''}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** Points a profile at a newly uploaded photo. */
export async function setProfilePhoto(userId: string, photoKey: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: PROFILES_TABLE,
      Key: { userId },
      UpdateExpression: 'SET #photoKey = :photoKey, #updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeNames: { '#photoKey': 'photoKey', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':photoKey': photoKey, ':updatedAt': Date.now() },
    }),
  );
}

/**
 * The profile behind an account, named as the identity provider named it if
 * there is none yet.
 *
 * The naming happens on the first read rather than at sign-up: a row created
 * here is created from claims only this service can see, and creating it on the
 * way in would mean every signed-in person has a row whether anybody will ever
 * look at it or not. The write is conditional, so two requests racing each other
 * name the account once.
 */
export async function ensureProfile(user: AuthUser): Promise<ProfileRow> {
  const existing = await getProfile(user.userId);
  if (existing) return existing;

  const now = Date.now();
  const profile: ProfileRow = {
    userId: user.userId,
    name: defaultProfileName(user),
    bio: '',
    socials: {},
    createdAt: now,
    updatedAt: now,
  };

  await putProfileIfAbsent(profile);

  // Re-read rather than return what was just written: the conditional put may
  // have lost the race, and the row that won is the one that is true.
  return (await getProfile(user.userId)) ?? profile;
}

/** Profiles by `sub`, in one batch read. Missing entries are simply absent. */
export async function batchGetProfiles(
  userIds: string[],
): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await batchGetItems<ProfileRow>(
    PROFILES_TABLE,
    unique.map((userId) => ({ userId })),
  );

  return new Map(rows.map((row) => [row.userId, row]));
}

/**
 * A profile as the person themselves sees it, photo and all.
 *
 * The signed URL is minted per response for the reason a course cover is: the
 * object behind CloudFront's signature is reachable only through a URL that says
 * who may read it, and the screen that is allowed to is this one.
 */
export async function toProfile(
  profile: ProfileRow,
): Promise<ProfileRow & { photoUrl?: string }> {
  if (!profile.photoKey) return profile;

  return {
    ...profile,
    photoUrl: await buildProfilePhotoUrl(profile.userId, profile.photoKey),
  };
}

/**
 * A profile as the marketplace sees it.
 *
 * Everything the public shape carries is here, and nothing else is: a course
 * page gets a name, a face, a sentence and a handful of links. `fallbackName` is
 * what to credit when there is no row at all — an instructor who has never
 * opened their profile still gets named on the course they teach.
 */
export async function toPublicInstructor(
  userId: string,
  profile: ProfileRow | undefined,
  fallbackName: string,
): Promise<PublicInstructor> {
  return {
    userId,
    name: nameOf(profile, fallbackName),
    bio: profile?.bio ?? '',
    socials: profile?.socials ?? {},
    ...(profile?.photoKey
      ? { photoUrl: await buildProfilePhotoUrl(userId, profile.photoKey) }
      : {}),
  };
}
