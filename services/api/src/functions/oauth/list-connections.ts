import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { batchGetItems } from '../../lib/dynamodb';
import { handle, ok } from '../../lib/http';
import { OAUTH_APPS_TABLE } from '../../lib/oauth-apps';
import { listGrantsForUser } from '../../lib/oauth-grants';
import type { OAuthAppRecord, OAuthConnection } from '../../types';

/**
 * How many apps are read in one batch.
 *
 * DynamoDB refuses a `BatchGetItem` with more than a hundred keys — with a
 * validation error, not a partial answer — so a person who has authorized more
 * than a hundred apps would get a 500 on the one screen that lets them see and
 * withdraw permissions. There is no cap on how many apps a person may
 * *authorize*; only on how many they may register.
 */
const BATCH_SIZE = 100;

/**
 * The apps the caller has authorized: what they let in, and what each one may do.
 *
 * The other half of the consent screen, and the reason a consent screen is worth
 * having at all: a permission somebody granted once has to be a permission
 * somebody can find later, read, and take back. Every row here names an app, the
 * scopes it holds on this account, when it was connected and when it last did
 * anything.
 *
 * The apps are read **live** rather than denormalized onto the grant. An app can
 * rename itself, change its logo and rewrite its description at any moment, and
 * a person deciding whether to keep a connection needs to see what the app
 * *is* — not what it was called on the day they authorized it. It costs one
 * batch read, and the number of apps one person has authorized is a number they
 * can count.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const grants = await listGrantsForUser(user.userId);
  if (grants.length === 0) return ok({ connections: [] });

  const byId = new Map<string, OAuthAppRecord>();
  for (let i = 0; i < grants.length; i += BATCH_SIZE) {
    const batch = await batchGetItems<OAuthAppRecord>(
      OAUTH_APPS_TABLE,
      grants.slice(i, i + BATCH_SIZE).map((grant) => ({ appId: grant.appId })),
    );
    for (const app of batch) byId.set(app.appId, app);
  }

  const connections: OAuthConnection[] = [];
  for (const grant of grants) {
    const app = byId.get(grant.appId);
    // An app deleted between the two reads above: its grants are deleted with
    // it, so this is a row that is on its way out. Skipping it is right — the
    // alternative is a connections screen drawing a nameless row with a
    // Disconnect button that points at nothing.
    if (!app) continue;

    connections.push({
      appId: app.appId,
      clientId: app.clientId,
      name: app.name,
      description: app.description,
      ...(app.homepageUrl ? { homepageUrl: app.homepageUrl } : {}),
      ...(app.logoUrl ? { logoUrl: app.logoUrl } : {}),
      scopes: grant.scopes,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
      ...(grant.lastUsedAt ? { lastUsedAt: grant.lastUsedAt } : {}),
    });
  }

  return ok({ connections });
}

export const handler = handle(main);
