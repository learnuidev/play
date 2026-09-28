import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { ApiScope, OAuthApp, OAuthAppRecord, OAuthAppSummary } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { HttpError } from './http';
import { API_SCOPES } from './oauth-scopes';

export const OAUTH_APPS_TABLE = env.oauthAppsTableName;

/** GSI on the apps table: the client id a request authenticates *as*. */
const CLIENT_ID_INDEX = 'ClientIdIndex';

/** GSI on the apps table: every app one person has registered. */
const USER_CREATED_INDEX = 'UserCreatedIndex';

/**
 * What every client id starts with, and what every secret starts with.
 *
 * The same reasoning as `play_sk_`: a recognizable prefix is what makes a
 * credential found in a log, a paste or a commit identifiable as ours by whoever
 * finds it, and greppable by us when somebody reports one leaked. The two
 * prefixes differ because a client id is public and a secret is not, and a
 * string-scanning tool that cannot tell them apart is one that reports every
 * client id in a code sample.
 */
const CLIENT_ID_PREFIX = 'play_app_';
const CLIENT_SECRET_PREFIX = 'play_cs_';

/** How much of a secret is kept in the clear, to tell two of them apart in a list. */
const SECRET_DISPLAY_LENGTH = CLIENT_SECRET_PREFIX.length + 8;

/**
 * How many apps one person may register.
 *
 * A limit rather than a quota, for the same reason the key limit is one: nothing
 * here is metered, and an unbounded list of clients is an unbounded list of
 * things that can be lost. It is the same number as the key limit because it is
 * the same kind of number — more than anybody rotates through by hand.
 */
const MAX_APPS_PER_USER = 25;

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 280;
const MAX_REDIRECT_URIS = 10;
const MAX_URL_LENGTH = 2000;

/**
 * Schemes a redirect URI may never use.
 *
 * A redirect URI is where a person is *sent*, holding a code that acts as them,
 * so a scheme that a browser executes rather than navigates to is an
 * authorization screen that can be turned into a cross-site scripting gadget
 * against whoever is looking at it. Everything not on this list is allowed
 * through, because a native app's own scheme (RFC 8252) is how a desktop or
 * mobile client is handed a code back, and it is indistinguishable from any
 * other private scheme without a list of installed apps.
 */
const FORBIDDEN_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'];

/**
 * A fresh client id. Public: it travels in a URL a browser can read.
 *
 * 128 bits of `randomBytes`, and deliberately not checked for uniqueness against
 * the table. A collision would take something on the order of 2^64 ids to have a
 * coin-flip's chance, and a conditional write to prevent it would put a second
 * item — an id reserved but not yet an app — in front of every registration to
 * defend against a thing that will not happen. Uniqueness is what the index
 * gives: if two apps ever shared a client id, the token endpoint would resolve
 * one of them, which is the same failure a guessable id would have.
 */
export function generateClientId(): string {
  return `${CLIENT_ID_PREFIX}${randomBytes(16).toString('base64url')}`;
}

/**
 * A fresh client secret: `play_cs_` and 32 bytes of randomness.
 *
 * The same shape as an API key's secret and for the same reason: 256 bits of
 * `randomBytes`, nothing derived from the app's id or name, because everything
 * else about an app is public.
 */
export function generateClientSecret(): string {
  return `${CLIENT_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** The stored representation of a client secret: hex SHA-256. See `lib/api-keys`. */
export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** The part of a secret a list may show. */
export function clientSecretPrefixOf(secret: string): string {
  return secret.slice(0, SECRET_DISPLAY_LENGTH);
}

/** The row as its owner's app reads it: no hash, and no owner. */
export function toOAuthApp(record: OAuthAppRecord): OAuthApp {
  return {
    appId: record.appId,
    clientId: record.clientId,
    name: record.name,
    description: record.description,
    ...(record.homepageUrl ? { homepageUrl: record.homepageUrl } : {}),
    ...(record.logoUrl ? { logoUrl: record.logoUrl } : {}),
    redirectUris: record.redirectUris,
    scopes: record.scopes,
    isPublic: !record.clientSecretHash,
    ...(record.secretPrefix ? { clientSecretPrefix: record.secretPrefix } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function getOAuthApp(appId: string): Promise<OAuthAppRecord | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: OAUTH_APPS_TABLE, Key: { appId } }),
  );
  return res.Item as OAuthAppRecord | undefined;
}

/**
 * The app a client id belongs to.
 *
 * Through its own index rather than by reading every app, and it is the same
 * shape of lookup the key authorizer does: the token endpoint holds a client id
 * and nothing else, so that id has to be a key space of its own.
 */
export async function getOAuthAppByClientId(
  clientId: string,
): Promise<OAuthAppRecord | undefined> {
  const res = await client.send(
    new QueryCommand({
      TableName: OAUTH_APPS_TABLE,
      IndexName: CLIENT_ID_INDEX,
      KeyConditionExpression: '#clientId = :clientId',
      ExpressionAttributeNames: { '#clientId': 'clientId' },
      ExpressionAttributeValues: { ':clientId': clientId },
      Limit: 1,
    }),
  );
  return ((res.Items ?? []) as OAuthAppRecord[])[0];
}

/** Every app one person has registered, newest first. */
export async function listOAuthAppsForUser(userId: string): Promise<OAuthAppRecord[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: OAUTH_APPS_TABLE,
      IndexName: USER_CREATED_INDEX,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: MAX_APPS_PER_USER,
    }),
  );
  return (res.Items ?? []) as OAuthAppRecord[];
}

/**
 * Loads an app and requires the caller to be the one who registered it.
 *
 * Somebody else's app answers **404** rather than 403, which is the rule the key
 * endpoints already follow and for the same reason: which app ids exist is not a
 * stranger's business, and an app somebody does not own has nothing to tell
 * apart from one that was never registered.
 */
export async function requireOwnedApp(userId: string, appId: string): Promise<OAuthAppRecord> {
  const app = await getOAuthApp(appId);
  if (!app || app.userId !== userId) throw new HttpError(404, 'OAuth app not found');
  return app;
}

/**
 * An app as the consent screen draws it, and as a connection lists it.
 *
 * The public half of an app: what it is called, what it says about itself, where
 * it lives and its mark. Deliberately not the record — the redirect URIs, the
 * scopes it is registered for and the hash of its secret are its owner's
 * business, and a person deciding whether to trust an app needs the four fields
 * on this shape and none of the others.
 */
export function toAppSummary(record: OAuthAppRecord): OAuthAppSummary {
  return {
    appId: record.appId,
    clientId: record.clientId,
    name: record.name,
    description: record.description,
    ...(record.homepageUrl ? { homepageUrl: record.homepageUrl } : {}),
    ...(record.logoUrl ? { logoUrl: record.logoUrl } : {}),
  };
}

/**
 * Refuses to register an app when the caller already holds the maximum.
 *
 * Counted on a read, like the key allowance, and for the same reason: a counter
 * would be a number that drifts, and this one is read once per creation.
 */
async function assertAppAllowance(userId: string): Promise<void> {
  const apps = await listOAuthAppsForUser(userId);
  if (apps.length >= MAX_APPS_PER_USER) {
    throw new HttpError(
      409,
      `You already have ${MAX_APPS_PER_USER} OAuth apps. Delete one before registering another.`,
    );
  }
}

export interface CreateOAuthAppInput {
  userId: string;
  userEmail?: string;
  name: string;
  description: string;
  homepageUrl?: string;
  logoUrl?: string;
  redirectUris: string[];
  scopes: ApiScope[];
  /** A client that cannot keep a secret: no secret is minted at all. */
  isPublic: boolean;
}

/**
 * Registers an app and stores the hash of its secret.
 *
 * The secret is returned and never kept, exactly as a key's is: everything after
 * this reads the row by id or by client id, and nothing anywhere can reproduce
 * the secret. A public client gets none — the response says so by leaving
 * `secret` out, rather than by answering with a secret nobody should trust.
 */
export async function createOAuthApp(
  input: CreateOAuthAppInput,
): Promise<{ record: OAuthAppRecord; secret?: string }> {
  await assertAppAllowance(input.userId);

  const now = Date.now();
  const secret = input.isPublic ? undefined : generateClientSecret();

  const record: OAuthAppRecord = {
    appId: ulid(),
    clientId: generateClientId(),
    ...(secret
      ? { clientSecretHash: hashClientSecret(secret), secretPrefix: clientSecretPrefixOf(secret) }
      : {}),
    name: input.name,
    description: input.description,
    ...(input.homepageUrl ? { homepageUrl: input.homepageUrl } : {}),
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
    redirectUris: input.redirectUris,
    scopes: input.scopes,
    userId: input.userId,
    ...(input.userEmail ? { userEmail: input.userEmail } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await client.send(new PutCommand({ TableName: OAUTH_APPS_TABLE, Item: record }));

  return secret ? { record, secret } : { record };
}

export interface UpdateOAuthAppInput {
  name?: string;
  description?: string;
  homepageUrl?: string | null;
  logoUrl?: string | null;
  redirectUris?: string[];
  scopes?: ApiScope[];
}

/**
 * Edits an app, leaving every field the caller did not send alone.
 *
 * `null` clears a field and `undefined` does not touch it, which is the same
 * convention `updateProfile` uses: a form that sends only what changed must not
 * be able to erase what it did not mention.
 */
export async function updateOAuthApp(
  appId: string,
  patch: UpdateOAuthAppInput,
): Promise<OAuthAppRecord> {
  const assignments: string[] = ['updatedAt = :updatedAt'];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': Date.now() };

  const set = (field: string, value: unknown) => {
    names[`#${field}`] = field;
    assignments.push(`#${field} = :${field}`);
    values[`:${field}`] = value;
  };

  if (patch.name !== undefined) set('name', patch.name);
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.redirectUris !== undefined) set('redirectUris', patch.redirectUris);
  if (patch.scopes !== undefined) set('scopes', patch.scopes);
  // A cleared optional field is *removed* rather than set to null: nothing in
  // this service stores a null, and a reader asking "does this app have a
  // homepage" should not have to know that.
  const removeFields: string[] = [];
  if (patch.homepageUrl !== undefined) {
    if (patch.homepageUrl === null) removeFields.push('homepageUrl');
    else set('homepageUrl', patch.homepageUrl);
  }
  if (patch.logoUrl !== undefined) {
    if (patch.logoUrl === null) removeFields.push('logoUrl');
    else set('logoUrl', patch.logoUrl);
  }

  let expression = `SET ${assignments.join(', ')}`;
  if (removeFields.length > 0) {
    expression += ` REMOVE ${removeFields.map((field) => `#${field}`).join(', ')}`;
    for (const field of removeFields) names[`#${field}`] = field;
  }

  const res = await client.send(
    new UpdateCommand({
      TableName: OAUTH_APPS_TABLE,
      Key: { appId },
      UpdateExpression: expression,
      ConditionExpression: 'attribute_exists(appId)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes as OAuthAppRecord;
}

/**
 * Replaces an app's client secret, and answers with the new one exactly once.
 *
 * Rotating rather than adding: a client has one secret, and "make another" is
 * the wrong verb for a credential whose whole job is to be the one its app
 * holds. The old secret stops working at once, which is what an app that thinks
 * its secret leaked is asking for.
 */
export async function rotateClientSecret(
  appId: string,
): Promise<{ record: OAuthAppRecord; secret: string }> {
  const secret = generateClientSecret();

  const res = await client.send(
    new UpdateCommand({
      TableName: OAUTH_APPS_TABLE,
      Key: { appId },
      UpdateExpression:
        'SET clientSecretHash = :hash, secretPrefix = :prefix, updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(appId)',
      ExpressionAttributeValues: {
        ':hash': hashClientSecret(secret),
        ':prefix': clientSecretPrefixOf(secret),
        ':updatedAt': Date.now(),
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  return { record: res.Attributes as OAuthAppRecord, secret };
}

/**
 * Deletes an app.
 *
 * A hard delete, like revoking a key, and for the same reason: the row is the
 * client and nothing else. What it cannot do on its own is take the tokens
 * issued under it — those are keyed by the *grant*, and the caller here deletes
 * every grant before it deletes the app (see `revokeAppGrants`), because an app
 * that no longer exists must not leave a working token behind.
 */
export async function deleteOAuthApp(appId: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: OAUTH_APPS_TABLE,
        Key: { appId },
        ConditionExpression: 'attribute_exists(appId)',
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
}

/**
 * The app behind a set of client credentials, or a refusal.
 *
 * Client authentication as RFC 6749 defines it, and the three answers it has to
 * give:
 *
 * - an unknown client id is `invalid_client`, always — whether the app was
 *   deleted or never existed is not something a caller holding a wrong client id
 *   needs told;
 * - a **confidential** client must present its secret, compared in constant time
 *   against the stored hash, because this is a secret two parties both know and
 *   a byte-by-byte comparison leaks how much of a guess was right;
 * - a **public** client presents nothing, which is not a failure: it is a client
 *   that cannot keep a secret, and PKCE — demanded of both kinds at the
 *   authorization step — is what stands in for one.
 */
export async function authenticateClient(
  credentials: { clientId: string; clientSecret?: string; viaBasic: boolean },
): Promise<OAuthAppRecord> {
  const { clientId, clientSecret, viaBasic } = credentials;
  // A failure over HTTP Basic is a 401 with `WWW-Authenticate`, and a failure
  // where the credentials were in the body is a 400. RFC 6749 draws that line
  // because the header form is HTTP authentication and the body form is not.
  const fail = (description: string) =>
    new InvalidClientError(description, viaBasic ? 401 : 400);

  const app = await getOAuthAppByClientId(clientId);
  if (!app) throw fail('Unknown client_id');

  if (!app.clientSecretHash) {
    // A public client that sends a secret is confused rather than malicious, and
    // saying so is more useful than ignoring it: the alternative is an app that
    // believes it is authenticating when nothing is being checked.
    if (clientSecret) {
      throw fail('This client is public and authenticates with client_id alone');
    }
    return app;
  }

  if (!clientSecret) throw fail('client_secret is required');
  if (!secretsMatch(clientSecret, app.clientSecretHash)) {
    throw fail('Invalid client_secret');
  }
  return app;
}

/** Whether a presented secret is the one behind a stored hash, in constant time. */
function secretsMatch(presented: string, storedHash: string): boolean {
  const presentedHash = Buffer.from(hashClientSecret(presented), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (presentedHash.length !== expected.length) return false;
  return timingSafeEqual(presentedHash, expected);
}

/**
 * A client authentication failure, which is its own answer.
 *
 * `invalid_client` is the one OAuth error with a status code of its own: RFC
 * 6749 says a failed client authentication is **401** with `WWW-Authenticate`
 * when the client used the `Authorization` header, and 400 otherwise. Both are
 * the same error to an app, which is why one class carries both.
 */
export class InvalidClientError extends Error {
  constructor(
    description: string,
    /** 401 when the client used HTTP Basic, 400 when it did not. */
    public readonly status: 400 | 401 = 400,
  ) {
    super(description);
    this.name = 'InvalidClientError';
  }
}

/* ---------------------------------------------------------------- validation */

export function validateAppName(raw: string | undefined): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'name is required');
  if (name.length < MIN_NAME_LENGTH) {
    throw new HttpError(400, `name must be at least ${MIN_NAME_LENGTH} characters`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `name must be <= ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

/**
 * An app's one-line description, which is what the consent screen shows under
 * its name. Required, because a consent screen that shows a name and nothing
 * else asks somebody to agree to something they cannot read.
 */
export function validateAppDescription(raw: string | undefined): string {
  const description = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!description) throw new HttpError(400, 'description is required');
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(
      400,
      `description must be <= ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }
  return description;
}

/** An optional URL field: absent stays absent, and an empty string clears it. */
export function validateOptionalUrl(raw: string | undefined, field: string): string | undefined {
  const value = (raw ?? '').trim();
  if (!value) return undefined;
  if (value.length > MAX_URL_LENGTH) throw new HttpError(400, `${field} is too long`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, `${field} must be an absolute URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, `${field} must be http or https`);
  }
  if (url.username || url.password) {
    throw new HttpError(400, `${field} must not carry credentials`);
  }
  return url.toString();
}

/**
 * The redirect URIs an app may use, checked one at a time.
 *
 * The rules, and why each one is here:
 *
 * - **Absolute, and no fragment.** RFC 6749 forbids a fragment, and a relative
 *   URI would be resolved against whatever page the authorization screen is on,
 *   which is not something the app's author chose.
 * - **`https` anywhere, `http` only on loopback.** A code handed over plain
 *   HTTP is a code anybody on the path can take and spend within its minute of
 *   life; `localhost` is exempt because the traffic never leaves the machine,
 *   and without the exemption nothing could be developed locally.
 * - **Any other scheme is a native app's own** (RFC 8252), except the handful a
 *   browser executes instead of navigating to.
 * - **No credentials in the URL.** `https://user:pass@host/` is a URI that
 *   mostly appears in phishing, and there is no legitimate app that needs one
 *   here.
 *
 * Deliberately *not* checked: reachability, or whether the host resolves. This
 * service never calls a redirect URI; it only decides whether it is a place a
 * person may be sent.
 */
export function validateRedirectUris(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, 'redirectUris must be a non-empty array');
  }
  if (raw.length > MAX_REDIRECT_URIS) {
    throw new HttpError(400, `redirectUris may hold at most ${MAX_REDIRECT_URIS} entries`);
  }

  const uris = raw.map((entry) => validateRedirectUri(String(entry)));
  // Two of the same is a list somebody did not read, and one of them can never
  // be told from the other.
  return [...new Set(uris)];
}

/** One redirect URI, or a 400 naming what is wrong with it. */
export function validateRedirectUri(raw: string): string {
  const value = raw.trim();
  if (!value) throw new HttpError(400, 'Each redirect URI must be a non-empty string');
  if (value.length > MAX_URL_LENGTH) throw new HttpError(400, 'Redirect URI is too long');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, `Redirect URI must be absolute: ${value}`);
  }

  if (url.hash) {
    throw new HttpError(400, 'A redirect URI must not carry a fragment');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'A redirect URI must not carry credentials');
  }

  if (FORBIDDEN_SCHEMES.includes(url.protocol)) {
    throw new HttpError(400, `Redirect URIs may not use the ${url.protocol} scheme`);
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new HttpError(400, 'Plain http is only allowed for localhost redirect URIs');
  }

  return url.toString();
}

/** Whether a host is this machine. `[::1]` arrives from `URL` with its brackets. */
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * The scopes an app may be registered with: the catalogue, in the catalogue's
 * order, with anything unknown refused rather than dropped.
 */
export function validateAppScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'scopes must be an array');
  const requested = raw.map((entry) => String(entry));
  const unknown = requested.filter((scope) => !(API_SCOPES as string[]).includes(scope));
  if (unknown.length > 0) throw new HttpError(400, `Unknown scope: ${unknown.join(', ')}`);

  const scopes = API_SCOPES.filter((scope) => requested.includes(scope));
  // At least one, because an app that may do nothing is an app whose consent
  // screen asks a person to agree to nothing — and the next thing that happens
  // is the app failing at every call it makes.
  if (scopes.length === 0) throw new HttpError(400, 'An app must have at least one scope');
  return scopes;
}
