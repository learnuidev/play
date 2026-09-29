import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizReadAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { listQuizAttempts, toAttemptSummary, toPaperQuestion, toWireAttempt } from '../../lib/quiz-attempts';
import { listQuestionsForQuiz } from '../../lib/quiz-questions';

/**
 * A quiz as the learner taking it sees it: the questions, without the answers.
 *
 * This is the route `requireQuizAccess` was written around. What a quiz asks is
 * editorial material — it carries the answer key, and every authoring route
 * therefore demands a *write* on the organization — but a learner registered for
 * the course is not in that organization and never will be. So the read is the
 * course's, and the answer is a shape with the key removed rather than a row
 * with fields hidden: `toPaperQuestion` is the only thing that builds these.
 *
 * **Only verified questions are handed out**, and the rest are counted instead.
 * That is what the `NEEDS_VERIFICATION` status is for: a model's draft that
 * nobody has read must never mark anybody, and the alternative — serving it and
 * apologising later — is a learner being told they were wrong by a machine's
 * first guess. The page says how many were held back, so a quiz that looks short
 * explains itself rather than looking broken.
 *
 * The caller's own attempts ride along: a page always needs to know whether this
 * is a first sitting or a fourth, and fetching that separately would render the
 * score in the wrong state first.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireQuizReadAccess(contentId, userId);

  const questions = await listQuestionsForQuiz(contentId);
  const paper = questions.filter((question) => question.status === 'VERIFIED');
  const attempts = await listQuizAttempts(contentId, userId);

  return ok({
    questions: paper.map(toPaperQuestion),
    /** Asked, but nobody has read it yet — so it is not asked of a learner. */
    heldBack: questions.length - paper.length,
    // The sittings are summarised and only the newest travels in full: the page
    // draws one result, and twenty of them with their answers would be twenty
    // times the read for nothing on the screen.
    attempts: attempts.map(toAttemptSummary),
    ...(attempts[0] ? { lastAttempt: toWireAttempt(attempts[0]) } : {}),
  });
}

export const handler = handle(main);
