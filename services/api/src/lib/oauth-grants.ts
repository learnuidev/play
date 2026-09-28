import { DeleteCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ApiScope, OAuthGrantRecord } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { revokeTokensForGrant } from './oauth-tokens';

export const OAUTH_GRANTS_TABLE = env.oauthGrantsTableName;

/**
 * GSI on the grants table: everyone who has authorized one app.
 *
 * The table is keyed by the *person* — `userId` and `appId` together — because
 * that pair is what a grant is, and because the screen that reads grants is the
 * person's own: "what have I let in". This index is the other direction, and it
 * exists for exactly one caller: deleting an app has to take every authorization
 * of it with it, or an app that no longer exists leaves working tokens behind.
 *
 * It is not a surface. Whoever registered an app cannot read this index; nothing
 * in this service counts it or draws it. That a person authorized an app is
 * between them and the app.
 */
const APP_GRANTED_INDEX = 'AppGrantedIndex';

/**
 * How stale `lastUsedAt` may be before a request bothers to write it.
 *
 * The same window the key authorizer uses, for the same reason: authenticating
 * is a read and recording that something was used is a write, and putting that
 * write in front of every call a customer makes — to keep a timestamp the
 * connections screen shows as "2 minutes ago" instead of "5 minutes ago" — is
 * the wrong trade.
 */
const LAST_USED_REFRESH_MS = 5 * 60 * 1000;

export interface UpsertGrantInput {
  userId: string;
  appId: string;
  scopes: ApiScope[];
}

/**
 * Records that a person authorized an app, with these scopes.
 *
 * An upsert, because the pair is the identity of the grant: consenting again
 * replaces the answer rather than stacking a second one, so a person who
 * authorizes an app for less than they did last time has narrowed it, and the
 * row that would have kept the wider set is the same row.
 *
 * `createdAt` is written only when there is not one — `if_not_exists` — so the
 * connections screen can say both "you connected this in March" and "you last
 * agreed to this today", which are the two questions somebody asks before
 * disconnecting something.
 */
export async function upsertGrant(input: UpsertGrantInput): Promise<void> {
  const now = Date.now();
  await client.send(
    new UpdateCommand({
      TableName: OAUTH_GRANTS_TABLE,
      Key: { userId: input.userId, appId: input.appId },
      UpdateExpression:
        'SET scopes = :scopes, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
      ExpressionAttributeValues: { ':scopes': input.scopes, ':now': now },
    }),
  );
}

export async function getGrant(
  userId: string,
  appId: string,
): Promise<OAuthGrantRecord | undefined> {
  const res = await client.send(
    new GetCommand({
      TableName: OAUTH_GRANTS_TABLE,
      Key: { userId, appId },
    }),
  );
  return res.Item as OAuthGrantRecord | undefined;
}

/** Every app one person has authorized, most recently agreed to first. */
export async function listGrantsForUser(userId: string): Promise<OAuthGrantRecord[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: OAUTH_GRANTS_TABLE,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
    }),
  );

  const grants = (res.Items ?? []) as OAuthGrantRecord[];
  return grants.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Every authorization of one app, across every person who granted it.
 *
 * Read only by the sweep that follows deleting an app. See `APP_GRANTED_INDEX`.
 *
 * Paged to the end: a query answers at most 1 MB, and the caller is a deletion
 * that believes it has ended every authorization of an app. Stopping at the
 * first page would leave the rest of them working, which is the one outcome
 * deleting an app exists to prevent.
 */
export async function listGrantsForApp(appId: string): Promise<OAuthGrantRecord[]> {
  const grants: OAuthGrantRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: OAUTH_GRANTS_TABLE,
        IndexName: APP_GRANTED_INDEX,
        KeyConditionExpression: '#appId = :appId',
        ExpressionAttributeNames: { '#appId': 'appId' },
        ExpressionAttributeValues: { ':appId': appId },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );

    grants.push(...((res.Items ?? []) as OAuthGrantRecord[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return grants;
}

/**
 * Records that an app just used a grant, at most once per refresh window.
 *
 * Conditional on the timestamp being absent or older than the window, so the
 * common case — the fiftieth call in a minute — writes nothing, and the failure
 * of that condition is the expected outcome rather than an error. A usage
 * timestamp that could not be written never fails the request it describes: the
 * call is authenticated, and that is the part that matters.
 */
export async function touchGrant(userId: string, appId: string): Promise<void> {
  try {
    await client.send(
      new UpdateCommand({
        TableName: OAUTH_GRANTS_TABLE,
        Key: { userId, appId },
        UpdateExpression: 'SET lastUsedAt = :now',
        ConditionExpression:
          'attribute_exists(userId) AND (attribute_not_exists(lastUsedAt) OR lastUsedAt < :staleBefore)',
        ExpressionAttributeValues: {
          ':now': Date.now(),
          ':staleBefore': Date.now() - LAST_USED_REFRESH_MS,
        },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return;
    console.error('Could not record OAuth grant use', err);
  }
}

/**
 * Disconnects an app for one person: the grant, and every token it produced.
 *
 * **The row goes first, and the tokens follow.** That is the opposite of what
 * "delete the credentials, then the record" suggests, and it is the order that
 * makes disconnecting stick. A refresh token can be redeemed at any moment, and
 * the sweep below is a read followed by deletes: a refresh that read its token
 * *before* this ran and wrote a new pair *after* it would leave credentials
 * behind that no sweep will ever look at again — a working 30-day refresh token
 * for an app the person has disconnected, with nothing on any screen to say so.
 *
 * With the row first, the grant is the authority: the token endpoint refuses a
 * refresh whose grant is gone, and it re-checks after issuing (see
 * `functions/oauth/token.ts`), so the window closes from both sides. What is
 * left if the sweep fails is rows with no grant pointing at them, which the next
 * call to this function or to `deleteGrantsForApp` finishes off.
 *
 * Answers whether there was a grant to delete, so that disconnecting twice is
 * one success and one absence rather than two.
 */
export async function deleteGrant(userId: string, appId: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteCommand({
        TableName: OAUTH_GRANTS_TABLE,
        Key: { userId, appId },
        ConditionExpression: 'attribute_exists(userId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }

  await revokeTokensForGrant(userId, appId);
  return true;
}

/**
 * Every authorization of an app, ended — the sweep that makes deleting an app
 * safe.
 *
 * Deleting an app is not only "this client may no longer ask": it has to be
 * "nothing this client was ever given still works", or the app id in a token
 * row would outlive the app that owns it.
 */
export async function deleteGrantsForApp(appId: string): Promise<number> {
  const grants = await listGrantsForApp(appId);
  await Promise.all(grants.map((grant) => deleteGrant(grant.userId, appId)));
  return grants.length;
}
