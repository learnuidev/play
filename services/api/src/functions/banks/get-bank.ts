import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireBankAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * One bank, on its own.
 *
 * The bank page reads its questions and its row in one request —
 * `GET /banks/{bankId}/questions` answers both — so this exists for the pages
 * that need the bank and nothing in it: a dialog that renames one, and a link
 * that is opened before its questions have loaded.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const bank = await requireBankAccess(pathParam(event, 'bankId'), userId, 'read');

  return ok({ bank });
}

export const handler = handle(main);
