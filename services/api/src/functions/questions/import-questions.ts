import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireBankAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getContent } from '../../lib/contents';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseImportFile } from '../../lib/question-import';
import { addBankQuestionCount } from '../../lib/question-banks';
import {
  assertLesson,
  nextQuestionPosition,
  putQuestion,
  toQuestionRow,
  type ParsedQuestion,
} from '../../lib/questions';

interface ImportQuestionsBody {
  fileName?: unknown;
  /** The file itself, base64. */
  contentBase64?: unknown;
  /** The lesson every question in the file is about. */
  lessonContentId?: unknown;
}

/**
 * Imports questions from a spreadsheet, a CSV or a JSON file.
 *
 * The file arrives as base64 inside a JSON body rather than as a multipart
 * upload, and that is a decision about the API rather than about convenience:
 * API Gateway's REST integration has no multipart parser, and one added here
 * would be a second way for every request to be read. A file that has been
 * base64'd is a string, and a string is what this service already knows how to
 * take.
 *
 * **One file, one lesson.** The lesson is a field of the request rather than a
 * column of the sheet: a lesson is named by a title that is not unique, and a
 * file whose rows each meant a different lesson would need an importer that
 * guesses. A file covering two lessons is imported twice, which is a sentence in
 * the dialog rather than a feature nobody can explain.
 *
 * The parsing rules — which headings mean what, how an answer is spelled, and
 * why a bad row is reported rather than thrown — are in `lib/question-import`,
 * which is also where the template this API hands out is generated from.
 *
 * Every row that reads lands `NEEDS_VERIFICATION`, like a generated one: the
 * file came from somewhere else, and nobody here has read it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const bankId = pathParam(event, 'bankId');

  const bank = await requireBankAccess(bankId, userId, 'write');
  const body = jsonBody<ImportQuestionsBody>(event);

  if (typeof body.fileName !== 'string' || !body.fileName.trim()) {
    throw new HttpError(400, 'fileName is required');
  }
  if (typeof body.contentBase64 !== 'string' || !body.contentBase64.trim()) {
    throw new HttpError(400, 'contentBase64 is required');
  }
  if (typeof body.lessonContentId !== 'string' || !body.lessonContentId.trim()) {
    throw new HttpError(400, 'lessonContentId is required — every question is about a lesson');
  }

  const lesson = await getContent(body.lessonContentId.trim());
  assertLesson(lesson, bank.organizationId);

  const outcome = await parseImportFile({
    fileName: body.fileName.trim(),
    contentBase64: body.contentBase64,
  });

  const now = Date.now();
  let position = await nextQuestionPosition(bank.bankId);

  const imported = [];
  const skipped = [];

  for (const row of outcome.rows) {
    if (!row.question) {
      skipped.push({ row: row.row, error: row.error ?? 'Could not read this row' });
      continue;
    }

    const question = toQuestionRow(
      {
        bankId: bank.bankId,
        organizationId: bank.organizationId,
        lessonContentId: lesson.contentId,
        lessonSpaceId: lesson.spaceId,
        parsed: row.question as ParsedQuestion,
        source: 'IMPORT',
        position,
        createdBy: userId,
      },
      ulid(),
      now,
    );

    await putQuestion(question);
    imported.push(question);
    position += 1;
  }

  await addBankQuestionCount(bank.bankId, imported.length);

  return ok({ imported, skipped, rows: outcome.total }, 201);
}

export const handler = handle(main);
