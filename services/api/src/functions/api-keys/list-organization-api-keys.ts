import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listActiveApiKeysForOrganization, toOrganizationApiKey } from '../../lib/api-keys';
import { requireOrganizationAdmin } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging, pathParam } from '../../lib/http';

/**
 * Every API key this organization holds, whoever made it.
 *
 * An admin's list, and the reason a key can name an organization at all: keys
 * outlive the employment that created them, and the person holding the account
 * when one has to be cut off is rarely the person who made it.
 *
 * Revoked keys are not among them — what an admin is looking at is the access
 * that is still live, which is the list to compare against the people who
 * should still have it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');

  await requireOrganizationAdmin(user.userId, orgId);

  const { keys, lastEvaluatedKey } = await listActiveApiKeysForOrganization(
    orgId,
    parsePaging(event),
  );

  return ok({
    keys: keys.map(toOrganizationApiKey),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
