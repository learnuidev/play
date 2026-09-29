import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireBankAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { countNeedingVerification, listQuestionsByBank } from '../../lib/questions';

/**
 * A bank's questions, in the order it holds them.
 *
 * The bank itself comes back with them, so one request draws the whole page —
 * its name, its description, how much is in it, and what still needs reading.
 * The page groups them by lesson on the client: a bank is a list somebody works
 * down, and the grouping is how it is read rather than how it is stored.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const bank = await requireBankAccess(pathParam(event, 'bankId'), userId, 'read');

  const questions = await listQuestionsByBank(bank.bankId);

  return ok({ bank, questions, needsVerification: countNeedingVerification(questions) });
}

export const handler = handle(main);
