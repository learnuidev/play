import type { EventBridgeEvent } from 'aws-lambda';
import { GENERATION_DETAIL_TYPE, runGeneration, type GenerationJobDetail } from '../../lib/quiz-generation';

/**
 * The worker that writes a quiz's questions.
 *
 * It has no route: it is driven by the event `request-question-generation`
 * publishes, because the request that asks for a run has to answer in seconds
 * and the run takes minutes. Everything it does — what it reads, what it does
 * when the quiz has been deleted, what it records when the model refuses — is in
 * `lib/quiz-generation`.`runGeneration`, which is where it can be read as one
 * piece rather than through the seam an event leaves in the middle of it.
 *
 * The handler never throws. A thrown error here would land in a CloudWatch log
 * group nobody is watching while the author stares at a page that says a run is
 * in progress; the failure is written onto the quiz instead, where the page will
 * find it.
 */
export async function handler(
  event: EventBridgeEvent<typeof GENERATION_DETAIL_TYPE, GenerationJobDetail>,
): Promise<void> {
  const detail = event.detail;
  if (!detail?.contentId || !detail.sourceContentId) {
    console.error('Quiz generation event carried no job', JSON.stringify(event));
    return;
  }

  await runGeneration(detail);
}
