import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { toBillingEntries } from '../../lib/billing';
import { handle, ok } from '../../lib/http';
import { listPaymentsForUser } from '../../lib/payments';

/**
 * What this person has bought, newest first — the receipts.
 *
 * **A payment still in flight is not one of them.** `PENDING` means a checkout
 * was opened and not finished: nobody was charged, there is nothing to refund,
 * and there is nothing to read. What it does is accumulate — every visit to a
 * checkout page that somebody closed is one more row saying the same thing — so
 * a list that included them opened on a wall of "Payment pending" underneath the
 * courses somebody had actually paid for.
 *
 * The row itself is not deleted and must not be: it is how support answers "did
 * they try?", and it is what the webhook moves when the money does arrive. It is
 * only left out of the answer to *this* question.
 *
 * The other four statuses stay, because each of them is an outcome — paid,
 * refunded, declined, or a checkout nobody went through with — and an outcome is
 * what somebody opens their own billing history to find. The screen draws them
 * differently; this route does not decide that for it.
 *
 * Scoped by construction like every read under `/me`: the query is by the
 * caller's own `sub`, so no id in the request can widen it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const payments = await listPaymentsForUser(userId);

  return ok({
    payments: await toBillingEntries(
      payments.filter((payment) => payment.status !== 'PENDING'),
    ),
  });
}

export const handler = handle(main);
