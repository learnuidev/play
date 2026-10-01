import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuestionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getContent } from '../../lib/contents';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import {
  assertLesson,
  getQuestion,
  parseQuestionInput,
  readQuestionDifficulty,
  updateQuestion,
  type UpdateQuestionPatch,
} from '../../lib/questions';
import type { QuizQuestion } from '../../types';

interface UpdateQuestionBody {
  type?: unknown;
  prompt?: unknown;
  options?: unknown;
  answer?: unknown;
  /** A string, or `null` to clear it. */
  explanation?: unknown;
  /** Point the question at a different lesson. */
  lessonContentId?: unknown;
  /** A level, or `null`/empty to leave the question ungraded. */
  difficulty?: unknown;
}

/** The marker `resolveAnswer` prefixes a refusal with, so it can be thrown as a 400. */
const MISSING_ANSWER = 'missing answer: ';

/**
 * Which option is right after this edit.
 *
 * Three cases, and the middle one is the reason this is a function:
 *
 * - the request says (`answer`), and that is the answer;
 * - the request rewrites the *options* without saying, and the answer follows
 *   the option it named — reordering a question's choices must not silently move
 *   the tick from the right one to the wrong one, which is exactly what keeping
 *   the old letter would do;
 * - nothing in the request touches either, and the question keeps the answer it
 *   had.
 *
 * The refusal is returned as a prefixed string rather than thrown from in here,
 * because this is also the path an unchanged question takes and it must not be
 * able to fail.
 */
function resolveAnswer(body: UpdateQuestionBody, existing: QuizQuestion): unknown {
  if (body.answer !== undefined) return body.answer;

  if (body.options === undefined) return existing.correctOptionIds[0];

  const current = existing.options.find((option) => option.id === existing.correctOptionIds[0]);
  if (!current) return existing.correctOptionIds[0];

  const texts = Array.isArray(body.options)
    ? body.options.map((option) => (typeof option === 'string' ? option.trim() : ''))
    : [];

  // The option that was the answer is gone, and only the request can say what
  // replaced it. Guessing — "the option in the same place" — is how a question
  // ends up marked against an answer nobody chose.
  if (!texts.some((text) => text.toLowerCase() === current.text.toLowerCase())) {
    return `${MISSING_ANSWER}the option that was the answer is no longer among the options — send "answer" to say which one is right now`;
  }

  return current.text;
}

/**
 * Changes a question: its words, its options, which one is right, the lesson it
 * is about, or how hard it is meant to be.
 *
 * Two things make this more than a patch. The first is that anything touching
 * the type, the options or the answer is re-validated as a whole question rather
 * than field by field — switching a multiple-choice question to true/false
 * replaces its options with True and False, and the answer has to be re-read
 * against them. The second is that an edit to what a question *says*, or to the
 * lesson it is about, takes its verification away: somebody said "this is right",
 * about a sentence and a lesson, and one that has changed since is one nobody has
 * said anything about. See `UpdateQuestionPatch`.
 *
 * A difficulty is neither: it is a judgement about the question rather than a
 * change to it, so setting one — or taking one away — leaves the verification
 * where it was. See the note on `UpdateQuestionPatch.difficulty`.
 *
 * An edit here is visible everywhere the question is asked, because a quiz does
 * not own it. That is the point of a bank, and the page says so before somebody
 * changes a question three quizzes are using.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const questionId = pathParam(event, 'questionId');

  const existing = await requireQuestionAccess(questionId, userId, 'write');
  const body = jsonBody<UpdateQuestionBody>(event);

  const patch: UpdateQuestionPatch = {};
  let changesTheQuestion = false;

  if (body.type !== undefined || body.options !== undefined || body.answer !== undefined) {
    // Anything that touches the options or the answer is re-read as one
    // question, because the three only make sense together: an answer is an
    // option, and an option list is a whole.
    const answer = resolveAnswer(body, existing);
    if (typeof answer === 'string' && answer.startsWith(MISSING_ANSWER)) {
      throw new HttpError(400, answer.slice(MISSING_ANSWER.length));
    }

    const parsed = parseQuestionInput({
      type: body.type ?? existing.type,
      prompt: body.prompt ?? existing.prompt,
      // An unchanged multiple-choice question keeps its options; an unchanged
      // true/false one has none to keep, and its two are fixed anyway.
      options:
        body.options ??
        (existing.type === 'MULTIPLE_CHOICE' ? existing.options.map((option) => option.text) : undefined),
      answer,
      explanation: existing.explanation,
    });

    if ('error' in parsed) throw new HttpError(400, parsed.error);

    patch.type = parsed.question.type;
    patch.options = parsed.question.options;
    patch.correctOptionIds = parsed.question.correctOptionIds;
    changesTheQuestion =
      parsed.question.type !== existing.type ||
      parsed.question.correctOptionIds.join() !== existing.correctOptionIds.join() ||
      JSON.stringify(parsed.question.options) !== JSON.stringify(existing.options);
  }

  if (body.prompt !== undefined) {
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      throw new HttpError(400, 'prompt is required');
    }
    const prompt = body.prompt.trim().replace(/\s+/g, ' ');
    if (prompt !== existing.prompt) {
      patch.prompt = prompt;
      changesTheQuestion = true;
    }
  }

  if (body.lessonContentId !== undefined) {
    if (typeof body.lessonContentId !== 'string' || !body.lessonContentId.trim()) {
      throw new HttpError(400, 'lessonContentId must be a lesson id');
    }

    const lesson = await getContent(body.lessonContentId.trim());
    assertLesson(lesson, existing.organizationId);

    if (lesson.contentId !== existing.lessonContentId) {
      patch.lessonContentId = lesson.contentId;
      patch.lessonSpaceId = lesson.spaceId;
      // A question moved to another lesson is a question about something else,
      // so whoever verified the old one verified a different question.
      changesTheQuestion = true;
    }
  }

  if (body.explanation !== undefined) {
    if (body.explanation === null || body.explanation === '') {
      patch.explanation = null;
    } else if (typeof body.explanation === 'string') {
      patch.explanation = body.explanation.trim();
    } else {
      throw new HttpError(400, 'explanation must be a string or null');
    }
  }

  // How hard the question is, which is a judgement about it rather than a change
  // to it: `changesTheQuestion` is deliberately not touched here, because a
  // question somebody verified is the same question at any level. A level the
  // question already carries is not written again — an edit that changes nothing
  // should not move `updatedAt`.
  if (body.difficulty !== undefined) {
    if (body.difficulty === null || body.difficulty === '') {
      if (existing.difficulty) patch.difficulty = null;
    } else {
      const read = readQuestionDifficulty(body.difficulty);
      if ('error' in read) throw new HttpError(400, read.error);
      if (read.difficulty && read.difficulty !== existing.difficulty) {
        patch.difficulty = read.difficulty;
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return ok({ question: existing });
  }

  // Only an edit to the question itself invalidates the verification: clearing
  // an explanation, or correcting a typo *in* one, does not change what is being
  // asked, and re-opening a verified question for that would train an author to
  // ignore the state.
  await updateQuestion(questionId, { ...patch, invalidateVerification: changesTheQuestion });

  return ok({ question: await getQuestion(questionId) });
}

export const handler = handle(main);
