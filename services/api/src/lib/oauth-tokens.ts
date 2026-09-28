import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { ApiScope, OAuthCodeRecord, OAuthTokenRecord } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';

export const OAUTH_TOKENS_TABLE = env.oauthTokensTableName;
export const OAUTH_CODES_TABLE = env.oauthCodesTableName;

/** GSI on the tokens table: the credential a presented secret is. */
const TOKEN_HASH_INDEX = 'TokenHashIndex';

/** GSI on the tokens table: every credential one authorization produced. */
const GRANT_KEY_CREATED_INDEX = 'GrantKeyCreatedIndex';

/**
 * A grant's synthesized key: the person and the app, as one attribute.
 *
 * Tokens carry it so that "every credential this authorization produced" is a
 * query rather than a scan — DynamoDB indexes an attribute and not an expression,
 * and a token row holding the two ids separately could not be reached by both at
 * once. It lives here, with the index it belongs to, rather than with grants:
 * `lib/oauth-grants` reads tokens to end an authorization, and a module that
 * both imported the other would be a cycle for the sake of one `join('#')`.
 */
export function grantKeyOf(userId: string, appId: string): string {
  return `${userId}#${appId}`;
}

/**
 * What each credential starts with.
 *
 * Three prefixes, so that a credential found in the wild says what it is without
 * anybody having to look it up: an access token presented as a refresh token is
 * a mistake worth being able to see in a log line. `play_at_`, `play_rt_` and
 * `play_ac_` — the same reasoning as `play_sk_` and `play_cs_` for keys and
 * client secrets.
 */
const ACCESS_TOKEN_PREFIX = 'play_at_';
const REFRESH_TOKEN_PREFIX = 'play_rt_';
const CODE_PREFIX = 'play_ac_';

/**
 * How long an access token lasts.
 *
 * An hour: long enough that a client is not asking for a token on every call,
 * short enough that a token that leaked is worthless before the day is out. It
 * is also the window in which "I disconnected that app" and "the app's calls
 * stopped" are within an hour of each other — which is the same bargain the key
 * authorizer makes by caching nothing, and it is deliberately in the same
 * direction: revocation is instant and expiry is not the mechanism.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * How long a refresh token lasts.
 *
 * Thirty days. A refresh token cannot be revoked by expiry in any useful sense —
 * it is what a person's connection to an app is *made of* — so this is a bound
 * on how long an app that has been forgotten about can keep getting new access
 * tokens, rather than a security control. Revocation is the control, and it is
 * immediate.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * How long an authorization code lives.
 *
 * Sixty seconds. A code exists to survive one redirect through one browser and
 * is then exchanged immediately; the OAuth specification's own recommendation is
 * "a maximum of ten minutes", which is generous for a step that a client
 * performs as its very next action.
 */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;

/** A fresh credential: its prefix and bytes of randomness. */
function generateCredential(prefix: string, bytes: number): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}

/**
 * The stored representation of a credential: hex SHA-256.
 *
 * A plain hash rather than a salted one, for the reason `lib/api-keys` gives for
 * the same choice: these are 256 bits of machine-generated randomness that exist
 * in exactly one place, so the attack that a salt defeats — a precomputed table
 * over a guessable secret — does not apply; and what the plain hash buys is the
 * lookup, which is the difference between authenticating a call in one read and
 * authenticating it by testing every credential ever issued.
 */
export function hashCredential(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Whether a PKCE verifier is the one the challenge was made from.
 *
 * The transformation is fixed by RFC 7636: base64url of SHA-256 of the verifier,
 * with no padding. Only S256 is supported and `plain` is refused at the
 * authorization step rather than here, because a challenge that was sent in the
 * clear is a challenge that proves nothing, and accepting it would quietly
 * downgrade every client that asked for it.
 *
 * Compared in constant time, though the verifier is not a secret in the way a
 * password is: it is a value an attacker who intercepted the code is trying to
 * guess, and a comparison that answers faster for a wrong first byte is exactly
 * the oracle PKCE exists to remove.
 */
export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(
    createHash('sha256').update(verifier, 'utf8').digest('base64url'),
  );
  const expected = Buffer.from(challenge);
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

/* ------------------------------------------------------------------- codes */

export interface IssueCodeInput {
  clientId: string;
  appId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: ApiScope[];
}

/**
 * Mints an authorization code and stores its hash.
 *
 * The code is returned and never kept: everything after this reads the row by
 * hash, and the only thing that ever needs the plaintext is the client that is
 * about to be handed it through a browser.
 */
export async function issueAuthorizationCode(input: IssueCodeInput): Promise<string> {
  const code = generateCredential(CODE_PREFIX, 32);
  const now = Date.now();

  const record: OAuthCodeRecord = {
    codeHash: hashCredential(code),
    clientId: input.clientId,
    appId: input.appId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scopes: input.scopes,
    createdAt: now,
    expiresAt: Math.floor(now / 1000) + AUTHORIZATION_CODE_TTL_SECONDS,
  };

  await client.send(new PutCommand({ TableName: OAUTH_CODES_TABLE, Item: record }));

  return code;
}

/** Why a code could not be redeemed, which the token endpoint reports by name. */
export type CodeRedemptionFailure =
  | 'unknown'
  | 'expired'
  | 'client'
  | 'redirect_uri'
  | 'verifier';

export type CodeRedemption =
  | { ok: true; record: OAuthCodeRecord }
  | { ok: false; reason: CodeRedemptionFailure };

/**
 * Redeems an authorization code, once, or says why it could not be.
 *
 * The order of the checks is the order the specification asks for them in, and
 * every failure is a single `invalid_grant` to the client — the distinctions are
 * kept here because they are worth a log line, not because a caller is told
 * them. Telling the holder of a wrong code *which* part of it was wrong is
 * telling them how to fix their guess.
 *
 * **Single use, by deletion.** The row is read, checked, and then deleted
 * conditionally: two clients redeeming the same code at the same instant both
 * read it, one wins the delete and the other gets `unknown`. That is deliberate
 * — a code that could be redeemed twice is a code worth stealing, and this
 * closes it without a transaction.
 *
 * What it deliberately does *not* do is revoke the tokens an already-redeemed
 * code produced, which RFC 6749 suggests as a SHOULD for a detected replay. A
 * replayed code cannot be detected here at all: it is deleted, so a second
 * attempt is indistinguishable from a code that never existed, and the machinery
 * to tell them apart — tombstones for every code ever issued — would exist to
 * serve a case that PKCE already makes worthless. A code that leaked on its way
 * through the browser cannot be spent without the verifier, which never left the
 * client.
 */
export async function redeemAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<CodeRedemption> {
  const codeHash = hashCredential(input.code);

  const res = await client.send(
    new GetCommand({ TableName: OAUTH_CODES_TABLE, Key: { codeHash } }),
  );
  const record = res.Item as OAuthCodeRecord | undefined;
  if (!record) return { ok: false, reason: 'unknown' };

  if (record.expiresAt <= Math.floor(Date.now() / 1000)) {
    // TTL deletes this row eventually, and eventually can be most of a day: the
    // expiry is checked here so that "expired" means expired.
    await deleteCode(codeHash);
    return { ok: false, reason: 'expired' };
  }

  if (record.clientId !== input.clientId) return { ok: false, reason: 'client' };
  if (record.redirectUri !== input.redirectUri) return { ok: false, reason: 'redirect_uri' };
  if (!verifyCodeChallenge(input.codeVerifier, record.codeChallenge)) {
    return { ok: false, reason: 'verifier' };
  }

  const deleted = await deleteCode(codeHash);
  if (!deleted) return { ok: false, reason: 'unknown' };

  return { ok: true, record };
}

/** Deletes a code, and says whether this call is the one that did it. */
async function deleteCode(codeHash: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: OAUTH_CODES_TABLE,
        Key: { codeHash },
        ConditionExpression: 'attribute_exists(codeHash)',
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
}

/* ------------------------------------------------------------------ tokens */

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds, for the token response's `expires_in`. */
  expiresIn: number;
  scopes: ApiScope[];
}

export interface IssueTokensInput {
  clientId: string;
  appId: string;
  userId: string;
  scopes: ApiScope[];
}

/**
 * Issues an access token and a refresh token, and records both by hash.
 *
 * The two are always issued together, and a refresh always replaces the pair:
 * the access token is what a caller presents and the refresh token is what it
 * comes back with, so issuing one without the other would leave a client either
 * unable to call anything or unable to come back at all.
 *
 * The **refresh token rotates**: redeeming one deletes it and answers with a new
 * one. That is the modern recommendation and it is a real improvement — a
 * refresh token that leaked is a refresh token that stops working the moment the
 * real client next uses its own — but it has a cost worth stating: a client that
 * loses the response to a refresh (a dropped connection, a process killed between
 * the call and the write) has lost its connection and has to be authorized
 * again. The alternative, a long-lived refresh token that never changes, makes
 * that impossible to get wrong and makes a leak permanent.
 */
export async function issueTokens(input: IssueTokensInput): Promise<IssuedTokens> {
  const accessToken = generateCredential(ACCESS_TOKEN_PREFIX, 32);
  const refreshToken = generateCredential(REFRESH_TOKEN_PREFIX, 32);
  const now = Date.now();
  const grantKey = grantKeyOf(input.userId, input.appId);

  const access: OAuthTokenRecord = {
    tokenId: ulid(),
    tokenHash: hashCredential(accessToken),
    kind: 'access',
    clientId: input.clientId,
    appId: input.appId,
    userId: input.userId,
    grantKey,
    scopes: input.scopes,
    createdAt: now,
    expiresAt: Math.floor(now / 1000) + ACCESS_TOKEN_TTL_SECONDS,
  };

  const refresh: OAuthTokenRecord = {
    ...access,
    tokenId: ulid(),
    tokenHash: hashCredential(refreshToken),
    kind: 'refresh',
    expiresAt: Math.floor(now / 1000) + REFRESH_TOKEN_TTL_SECONDS,
  };

  // Two writes rather than a transaction: they are independent rows in one
  // table, and the failure that a transaction would prevent — an access token
  // without a refresh token — costs a client one re-authorization, not a
  // credential that outlives its revocation.
  await client.send(new PutCommand({ TableName: OAUTH_TOKENS_TABLE, Item: access }));
  await client.send(new PutCommand({ TableName: OAUTH_TOKENS_TABLE, Item: refresh }));

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scopes: input.scopes,
  };
}

/**
 * The token a presented secret is, or nothing.
 *
 * Read through the hash index, so an unknown secret is one query that returns
 * nothing rather than a walk through every token ever issued — and since
 * revoking deletes rows, a revoked token and a token that never existed cost the
 * same nothing.
 *
 * Expiry is checked here rather than left to the table's TTL, which deletes
 * "within 48 hours". A credential that works for up to two days past its
 * `expires_at` is not a credential with an expiry.
 */
export async function findTokenBySecret(secret: string): Promise<OAuthTokenRecord | undefined> {
  const res = await client.send(
    new QueryCommand({
      TableName: OAUTH_TOKENS_TABLE,
      IndexName: TOKEN_HASH_INDEX,
      KeyConditionExpression: '#tokenHash = :tokenHash',
      ExpressionAttributeNames: { '#tokenHash': 'tokenHash' },
      ExpressionAttributeValues: { ':tokenHash': hashCredential(secret) },
      Limit: 1,
    }),
  );

  const record = ((res.Items ?? []) as OAuthTokenRecord[])[0];
  if (!record) return undefined;

  if (record.expiresAt <= Math.floor(Date.now() / 1000)) {
    await deleteToken(record.tokenId);
    return undefined;
  }

  return record;
}

/**
 * Deletes a token, and says whether this call is the one that did it.
 *
 * Conditional, so two revocations racing report one success and one absence
 * rather than two. The row is the credential and nothing else — its hash, who
 * authorized it, what it may reach — so a token that stops working leaves
 * nothing worth keeping behind.
 */
export async function deleteToken(tokenId: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: OAUTH_TOKENS_TABLE,
        Key: { tokenId },
        ConditionExpression: 'attribute_exists(tokenId)',
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
}

/**
 * Every token one authorization produced.
 *
 * Through the synthesized `grantKey`, because revocation is by grant: a token
 * does not know it has been revoked, it stops existing.
 *
 * **Paged to the end**, which matters more here than anywhere else in this
 * service: a DynamoDB query answers at most 1 MB and says so with a
 * `LastEvaluatedKey` rather than an error, so a caller that reads one page
 * silently under-deletes. A grant accumulates rows while it lives — every
 * refresh leaves its previous access token behind until the table's TTL gets to
 * it, which can be most of a day — so "one page is enough" is exactly the
 * assumption that would break the promise revocation makes.
 */
export async function listTokensForGrant(
  userId: string,
  appId: string,
): Promise<OAuthTokenRecord[]> {
  const tokens: OAuthTokenRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: OAUTH_TOKENS_TABLE,
        IndexName: GRANT_KEY_CREATED_INDEX,
        KeyConditionExpression: '#grantKey = :grantKey',
        ExpressionAttributeNames: { '#grantKey': 'grantKey' },
        ExpressionAttributeValues: { ':grantKey': grantKeyOf(userId, appId) },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );

    tokens.push(...((res.Items ?? []) as OAuthTokenRecord[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return tokens;
}

/**
 * Deletes every token one authorization produced.
 *
 * The one irreversible step of disconnecting an app, and the reason it is a
 * deletion rather than a flag: a revoked token has to stop authenticating on the
 * next request, and the cheapest way to make that true is for there to be
 * nothing left to find.
 *
 * Returns how many were deleted, which is what the revoke endpoint reports in
 * its log line and what a test asserts on.
 */
export async function revokeTokensForGrant(userId: string, appId: string): Promise<number> {
  const tokens = await listTokensForGrant(userId, appId);
  await Promise.all(tokens.map((token) => deleteToken(token.tokenId)));
  return tokens.length;
}

/**
 * The refresh token a client is presenting, or a refusal.
 *
 * Two checks beyond "it exists and has not expired", and both are the reason a
 * refresh token cannot simply be handed around: it must be a **refresh** token
 * (an access token replayed here would otherwise buy a month of new ones), and
 * it must belong to the **client presenting it**, or every app would be able to
 * refresh every other app's grants by guessing a token it was never given.
 */
export async function redeemRefreshToken(input: {
  token: string;
  appId: string;
}): Promise<OAuthTokenRecord | undefined> {
  const record = await findTokenBySecret(input.token);
  if (!record || record.kind !== 'refresh') return undefined;
  if (record.appId !== input.appId) return undefined;
  return record;
}

/**
 * Spends a refresh token: deletes it, so that the pair issued in its place is
 * the only way to keep the authorization alive.
 */
export async function spendRefreshToken(tokenId: string): Promise<boolean> {
  return deleteToken(tokenId);
}

/**
 * The caller behind an access token, or nothing.
 *
 * The authentication path of `/v1`, and the same shape as the key authorizer's:
 * one lookup by hash, and its absence is the whole answer. An access token that
 * belongs to a *grant* that has been disconnected is not found either, because
 * disconnecting deletes it — which is what makes "I disconnected that app" mean
 * the app stopped working rather than stopped being listed.
 */
export async function findAccessToken(secret: string): Promise<OAuthTokenRecord | undefined> {
  const record = await findTokenBySecret(secret);
  if (!record || record.kind !== 'access') return undefined;
  return record;
}
