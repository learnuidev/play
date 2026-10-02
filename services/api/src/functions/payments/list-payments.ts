import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { toBillingEntries } from '../../lib/billing';
import { handle, ok } from '../../lib/http';
import { listPaymentsForUser } from '../../lib/payments';

/**
 * What this person has bought, newest first — the receipts.
 *
 * Every attempt rather than only the successful ones, which is what the row's
 * five statuses are for: a checkout somebody abandoned and a payment that
 * failed are both things a person writes in about, and a list that showed only
 * what went through would have nothing to show them. The screen draws them
 * differently; this route does not decide that for it.
 *
 * Scoped by construction like every read under `/me`: the query is by the
 * caller's own `sub`, so no id in the request can widen it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const payments = await listPaymentsForUser(userId);

  return ok({ payments: await toBillingEntries(payments) });
}

export const handler = handle(main);
