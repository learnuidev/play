import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireOrganizationAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { putBank } from '../../lib/question-banks';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseText, parseTitle } from '../../lib/validation';
import type { QuestionBank } from '../../types';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

interface CreateBankBody {
  name?: unknown;
  description?: unknown;
}

/**
 * Makes a question bank.
 *
 * A bank belongs to the organization rather than to a course, which is the one
 * decision here worth stating: the questions in it are about *lessons*, and
 * which lesson a question is about is on the question. A course-shaped bank
 * would mean writing the same question again the moment two courses shared a
 * lesson's subject — and a question worth writing carefully is worth asking in
 * more than one place.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const orgId = pathParam(event, 'orgId');

  // Writing: a bank is organization material, so it takes an editor or an admin.
  await requireOrganizationAccess(userId, orgId, 'write');

  const body = jsonBody<CreateBankBody>(event);
  const now = Date.now();

  const bank: QuestionBank = {
    bankId: ulid(),
    organizationId: orgId,
    name: parseTitle(body.name, {
      min: MIN_NAME_LENGTH,
      max: MAX_NAME_LENGTH,
      field: 'name',
    }),
    description: parseText(body.description, MAX_DESCRIPTION_LENGTH, 'description'),
    // A counter kept on the row rather than counted on read, so the list of
    // banks can say how much is in each without a query per bank.
    questionCount: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await putBank(bank);

  return ok({ bank }, 201);
}

export const handler = handle(main);
