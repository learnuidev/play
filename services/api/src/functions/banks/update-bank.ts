import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireBankAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getBank, updateBank, type UpdateBankPatch } from '../../lib/question-banks';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseText, parseTitle } from '../../lib/validation';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

interface UpdateBankBody {
  name?: unknown;
  description?: unknown;
}

/**
 * Renames a bank, or rewrites what it says about itself.
 *
 * Only the fields sent are written, so a dialog that edits the name cannot
 * silently empty the description beside it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const bankId = pathParam(event, 'bankId');

  await requireBankAccess(bankId, userId, 'write');

  const body = jsonBody<UpdateBankBody>(event);
  const patch: UpdateBankPatch = {};

  if (body.name !== undefined) {
    patch.name = parseTitle(body.name, {
      min: MIN_NAME_LENGTH,
      max: MAX_NAME_LENGTH,
      field: 'name',
    });
  }
  if (body.description !== undefined) {
    patch.description = parseText(body.description, MAX_DESCRIPTION_LENGTH, 'description');
  }

  if (Object.keys(patch).length > 0) await updateBank(bankId, patch);

  return ok({ bank: await getBank(bankId) });
}

export const handler = handle(main);
