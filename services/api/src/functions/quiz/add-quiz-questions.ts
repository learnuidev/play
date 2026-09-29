import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { listQuestionsForQuiz, addQuestionsToQuiz } from '../../lib/quiz-questions';
import { getQuestion } from '../../lib/questions';
import type { QuizQuestion } from '../../types';

interface AddQuizQuestionsBody {
  /** The questions to ask, by id. They stay in their banks. */
  questionIds?: unknown;
}

/**
 * Adds questions to a quiz — the picker's one write.
 *
 * A quiz draws its questions from banks rather than holding them: it takes
 * references, and what it references keeps living where it was written. So this
 * adds *ids*, never questions, and the same question can be added by any number
 * of quizzes.
 *
 * The rule that makes a quiz coherent is enforced here rather than trusted to
 * the picker: a quiz asks questions about **its own course's lessons**. A
 * question about a lesson in another course would be a question its learners
 * cannot answer — the lesson is not in the course they registered for.
 *
 * Adding one twice is not an error: a picker that sends the same question again
 * is somebody unsure whether the first click worked, and answering that with a
 * failure would answer it wrongly. What was already there comes back counted.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const quiz = await requireQuizAccess(contentId, userId);
  const body = jsonBody<AddQuizQuestionsBody>(event);

  if (!Array.isArray(body.questionIds) || body.questionIds.length === 0) {
    throw new HttpError(400, 'questionIds must be a non-empty list of question ids');
  }
  if (body.questionIds.some((id) => typeof id !== 'string')) {
    throw new HttpError(400, 'questionIds must be a non-empty list of question ids');
  }

  const questions: QuizQuestion[] = [];
  for (const questionId of body.questionIds as string[]) {
    const question = await getQuestion(questionId);
    if (!question) throw new HttpError(404, `Question not found: ${questionId}`);
    questions.push(question);
  }

  const { added, alreadyAsked } = await addQuestionsToQuiz(quiz, questions, userId);

  return ok({ added, alreadyAsked, questions: await listQuestionsForQuiz(contentId) }, added > 0 ? 201 : 200);
}

export const handler = handle(main);
