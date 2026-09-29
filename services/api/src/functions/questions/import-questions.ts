import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getContent } from '../../lib/contents';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseImportFile } from '../../lib/question-import';
import { nextQuestionPosition, putQuestion, toQuestionRow, type ParsedQuestion } from '../../lib/questions';

interface ImportQuestionsBody {
  fileName?: unknown;
  /** The file itself, base64. */
  contentBase64?: unknown;
  /** The lesson the questions were written from, when the author says which. */
  sourceContentId?: unknown;
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
 * The parsing rules — which headings mean what, how an answer is spelled, and
 * why a bad row is reported rather than thrown — are in `lib/question-import`,
 * which is also where the template this API hands out is generated from.
 *
 * Every row that reads lands `NEEDS_VERIFICATION`, like a generated one: the
 * file came from somewhere else, and nobody here has read it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const quiz = await requireQuizAccess(contentId, userId);
  const body = jsonBody<ImportQuestionsBody>(event);

  if (typeof body.fileName !== 'string' || !body.fileName.trim()) {
    throw new HttpError(400, 'fileName is required');
  }
  if (typeof body.contentBase64 !== 'string' || !body.contentBase64.trim()) {
    throw new HttpError(400, 'contentBase64 is required');
  }

  // The lesson the questions are from, when one is named: a file of questions
  // about lesson four should say so, and a quiz may hold questions from several
  // lessons. It is checked to be one of this course's, so a stray id cannot
  // point a question at another organization's lesson.
  let sourceContentId: string | undefined;
  if (typeof body.sourceContentId === 'string' && body.sourceContentId.trim()) {
    const source = await getContent(body.sourceContentId.trim());
    if (!source || source.spaceId !== quiz.spaceId) {
      throw new HttpError(400, 'sourceContentId must be a lesson of this course');
    }
    sourceContentId = source.contentId;
  }

  const outcome = await parseImportFile({
    fileName: body.fileName.trim(),
    contentBase64: body.contentBase64,
    ...(sourceContentId ? { sourceContentId } : {}),
  });

  const now = Date.now();
  let position = await nextQuestionPosition(contentId);

  const imported = [];
  const skipped = [];

  for (const row of outcome.rows) {
    if (!row.question) {
      skipped.push({ row: row.row, error: row.error ?? 'Could not read this row' });
      continue;
    }

    const question = toQuestionRow(
      {
        contentId,
        spaceId: quiz.spaceId,
        organizationId: quiz.organizationId,
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

  return ok({ imported, skipped, rows: outcome.total }, 201);
}

export const handler = handle(main);
