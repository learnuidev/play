import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireBankAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getContent } from '../../lib/contents';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { addBankQuestionCount } from '../../lib/question-banks';
import {
  assertLesson,
  nextQuestionPosition,
  parseQuestionInput,
  putQuestion,
  toQuestionRow,
  type RawQuestionInput,
} from '../../lib/questions';

interface CreateQuestionBody extends RawQuestionInput {
  /** The lesson the question is about. Required. */
  lessonContentId?: unknown;
}

/**
 * Adds a question to a bank by hand.
 *
 * The one way in that must work when the other two do not: a teacher fixing a
 * word in a question, or writing the one thing a model keeps missing. What it
 * cannot do is leave out the lesson — a question without one is a question
 * nobody can tell is still true, and the route refuses rather than guessing at
 * the lesson the author had in mind.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const bankId = pathParam(event, 'bankId');

  const bank = await requireBankAccess(bankId, userId, 'write');
  const body = jsonBody<CreateQuestionBody>(event);

  if (typeof body.lessonContentId !== 'string' || !body.lessonContentId.trim()) {
    throw new HttpError(400, 'lessonContentId is required — every question is about a lesson');
  }

  const lesson = await getContent(body.lessonContentId.trim());
  assertLesson(lesson, bank.organizationId);

  const parsed = parseQuestionInput(body);
  if ('error' in parsed) throw new HttpError(400, parsed.error);

  const now = Date.now();
  const question = toQuestionRow(
    {
      bankId: bank.bankId,
      organizationId: bank.organizationId,
      lessonContentId: lesson.contentId,
      lessonSpaceId: lesson.spaceId,
      parsed: parsed.question,
      source: 'MANUAL',
      // Added at the end of the bank: where it goes next is not a decision
      // anybody is asked to make, because a bank is a library and not a sequence.
      position: await nextQuestionPosition(bank.bankId),
      createdBy: userId,
    },
    ulid(),
    now,
  );

  await putQuestion(question);
  await addBankQuestionCount(bank.bankId, 1);

  return ok({ question }, 201);
}

export const handler = handle(main);
