import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ulid } from 'ulid';
import type { Content, QuestionType, QuizGeneration } from '../types';
import { getContent, updateContent } from './contents';
import { getVideo } from './dynamodb';
import { parseVtt } from './vtt';
import { getObjectText } from './s3';
import {
  nextQuestionPosition,
  parseQuestionInput,
  putQuestion,
  toQuestionRow,
  type ParsedQuestion,
} from './questions';
import { env } from './config';

/**
 * Writing quiz questions from a lesson, with a model.
 *
 * Three things decide the shape of this file:
 *
 * - **A model's answer is a draft.** Everything it writes goes through
 *   `parseQuestionInput` — the same validator a hand-typed question and an
 *   imported row go through — and is stored `NEEDS_VERIFICATION`. A model is
 *   good at writing plausible questions from a transcript and entirely capable
 *   of writing one that is subtly wrong; nothing here is trusted because it
 *   came back with the right shape.
 * - **It does not fit in a request.** API Gateway answers a REST request in 29
 *   seconds at the very most, and a model reading a lesson transcript and
 *   writing ten questions routinely takes longer. So the request *queues* a run
 *   and answers at once, a function of its own does the work, and the page polls
 *   the run — the same shape a video's `status` has while it is transcoding.
 * - **The provider is one call.** Bedrock's `Converse` is the model-agnostic
 *   API — the same request body reaches an Amazon, Anthropic or Meta model —
 *   so `BEDROCK_MODEL_ID` is the whole of what choosing a model means.
 */

let client: BedrockRuntimeClient | undefined;
let events: EventBridgeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!client) client = new BedrockRuntimeClient({});
  return client;
}

function getEventBridgeClient(): EventBridgeClient {
  if (!events) events = new EventBridgeClient({});
  return events;
}

/** How many questions one run may ask for. */
export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 20;

/**
 * How much of a lesson is handed to the model.
 *
 * A transcript is roughly 15 characters per second of video, so this is about
 * forty minutes of talking — past it the lesson is cut off rather than the
 * request refused, because the first half of a lesson is where its subject is
 * introduced and questions are written from it either way.
 */
export const MAX_SOURCE_CHARS = 36_000;

/** How many questions are written in one model call. */
const DEFAULT_QUESTION_COUNT = 5;

/**
 * The lesson a run reads from, as text.
 *
 * A lesson is taught twice over: in what is said, and in what is written beside
 * it. Both go in — the transcript first, because it is the lesson — and a
 * lesson with neither is one there is nothing to write questions about, which is
 * what `empty` means rather than an error: the route that asked for the run
 * turns it into a sentence an author can act on.
 */
export interface LessonSource {
  /** What is handed to the model. */
  text: string;
  /** What was used, for the page and for the log. */
  hasTranscript: boolean;
  hasNotes: boolean;
  title: string;
}

export async function readLessonSource(content: Content): Promise<LessonSource> {
  const notes = content.notes ? proseMirrorToText(content.notes) : '';

  let transcript = '';
  if (content.videoId) {
    const video = await getVideo(content.videoId);
    if (video?.subtitleStatus === 'READY' && video.subtitleKey) {
      transcript = vttToText(await getObjectText(video.subtitleKey));
    }
  }

  const parts = [
    transcript ? `Transcript:\n${transcript}` : '',
    notes ? `Lesson notes:\n${notes}` : '',
  ].filter(Boolean);

  return {
    text: parts.join('\n\n').slice(0, MAX_SOURCE_CHARS),
    hasTranscript: Boolean(transcript),
    hasNotes: Boolean(notes),
    title: content.title,
  };
}

/**
 * The words of a TipTap/ProseMirror document.
 *
 * The same walk the frontend does to render notes, in the one form a model can
 * read: a document is a tree of nodes, and only the text nodes are words. Lists
 * and headings are flattened to lines rather than marked up, because what is
 * being read is the lesson's content and not its layout.
 */
export function proseMirrorToText(document: Record<string, unknown>): string {
  const lines: string[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const typed = node as { type?: string; text?: string; content?: unknown[] };

    if (typeof typed.text === 'string') {
      const last = lines.length - 1;
      if (last >= 0) lines[last] += typed.text;
      else lines.push(typed.text);
      return;
    }

    // A block starts a line; an inline wrapper does not.
    const isBlock = typed.type === 'paragraph' || typed.type === 'heading' || typed.type === 'listItem';
    if (isBlock && lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    for (const child of typed.content ?? []) walk(child);
  };

  walk(document);

  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** The spoken words of a subtitle track, one cue to a line. */
export function vttToText(vtt: string): string {
  return parseVtt(vtt)
    .map((cue) => cue.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * The instruction, and the shape of the answer.
 *
 * The JSON contract is stated twice — as instructions, and as an example — for
 * the reason it is stated at all: a model that returns prose around its JSON,
 * or an option list for a true/false question, costs a whole run and a retry.
 */
function buildPrompt(source: LessonSource, count: number, types: QuestionType[]): string {
  const kinds = types.includes('TRUE_FALSE') && types.includes('MULTIPLE_CHOICE')
    ? 'a mix of true/false and multiple-choice questions'
    : types.includes('TRUE_FALSE')
      ? 'true/false questions'
      : 'multiple-choice questions';

  return [
    `Write ${count} ${kinds} about the lesson below, for a learner who has just`,
    'watched it. Each question must be answerable from the lesson alone.',
    '',
    'Rules:',
    '- Test understanding of what the lesson teaches, not trivia about the wording.',
    '- A true/false question must be unambiguously true or false, and not a trick.',
    '- A multiple-choice question has 3 or 4 options, exactly one of which is right,',
    '  and the wrong ones must be plausible rather than obviously silly.',
    '- Every question needs a one-sentence explanation of why the answer is right.',
    '- Never refer to "the video", "the lesson" or "the speaker": the question must',
    '  stand on its own.',
    '',
    'Answer with JSON only — no prose, no markdown — in exactly this shape:',
    '{',
    '  "questions": [',
    '    {',
    '      "type": "MULTIPLE_CHOICE",',
    '      "prompt": "What does a 180-degree shutter angle do to motion blur?",',
    '      "options": ["Increases it", "Removes it", "Doubles it"],',
    '      "answer": "A",',
    '      "explanation": "A wider shutter angle lets light in for longer, so a moving subject blurs across more of each frame."',
    '    },',
    '    {',
    '      "type": "TRUE_FALSE",',
    '      "prompt": "A 180-degree shutter angle is the cinematic standard.",',
    '      "answer": "True",',
    '      "explanation": "It is the standard because it matches the motion blur a projector shows at 24 frames per second."',
    '    }',
    '  ]',
    '}',
    '',
    `The lesson is called "${source.title}".`,
    '',
    source.text,
  ].join('\n');
}

/** What a model call came back with, before it is trusted. */
interface RawQuestion {
  type?: unknown;
  prompt?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
}

/**
 * Pulls the JSON out of whatever the model said.
 *
 * A model asked for JSON usually returns JSON and occasionally returns JSON in a
 * markdown fence, or a sentence and then the JSON. Both are recoverable, and
 * recovering them is worth it: the alternative is failing a run that produced a
 * perfectly good set of questions.
 */
function extractQuestions(text: string): RawQuestion[] {
  const candidates: string[] = [text.trim()];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { questions?: unknown } | unknown[];
      const questions = Array.isArray(parsed) ? parsed : parsed.questions;
      if (Array.isArray(questions)) return questions as RawQuestion[];
    } catch {
      // Try the next shape.
    }
  }

  return [];
}

export interface GenerationResult {
  questions: ParsedQuestion[];
  /** Questions the model wrote that could not be read, and why. */
  rejected: string[];
  model: string;
}

/**
 * Asks the model for questions and keeps the ones that hold up.
 *
 * A question that fails validation is *dropped*, not fixed and not retried: a
 * run that writes eight good questions and two malformed ones has done its job,
 * and the author has eight questions to read. Only a run that produces nothing
 * usable fails, because an empty quiz with no explanation is the one outcome
 * somebody has to be told about.
 */
export async function generateQuestions(
  source: LessonSource,
  count: number,
  types: QuestionType[],
): Promise<GenerationResult> {
  const model = env.bedrockModelId;

  const response = await getClient().send(
    new ConverseCommand({
      modelId: model,
      system: [
        {
          text:
            'You write assessment questions for online courses. You answer with ' +
            'JSON and nothing else.',
        },
      ],
      messages: [{ role: 'user', content: [{ text: buildPrompt(source, count, types) }] }],
      // Temperature low enough that the same lesson produces a similar set of
      // questions twice: an author who regenerates is usually looking for the
      // run that failed, not for a different quiz.
      inferenceConfig: { maxTokens: 4096, temperature: 0.3, topP: 0.9 },
    }),
  );

  const text = (response.output?.message?.content ?? [])
    .map((block) => ('text' in block && block.text ? block.text : ''))
    .join('')
    .trim();

  const questions: ParsedQuestion[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const raw of extractQuestions(text)) {
    const parsed = parseQuestionInput({
      type: raw.type,
      prompt: raw.prompt,
      options: raw.options,
      answer: raw.answer,
      explanation: raw.explanation,
    });

    if ('error' in parsed) {
      rejected.push(parsed.error);
      continue;
    }

    // A model asked for five questions occasionally writes the same one twice.
    const fingerprint = parsed.question.prompt.toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    questions.push(parsed.question);
  }

  return { questions, rejected, model };
}

/**
 * Turns a Bedrock refusal into something an author can act on.
 *
 * The two failures everybody hits are a model this account has not been granted
 * and a model id that does not exist, and both arrive as a `ValidationException`
 * four hundred characters long. What the reader needs is which of the two it is
 * and where to fix it.
 */
export function describeBedrockError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/model use case details|not authorized|AccessDenied|access denied/i.test(message)) {
    return `Bedrock refused access to ${env.bedrockModelId}. Enable model access for it in the Bedrock console, or set BEDROCK_MODEL_ID to a model this account can call.`;
  }
  if (/could not be found|does not exist|modelIdentifier/i.test(message)) {
    return `Bedrock does not know the model ${env.bedrockModelId}. Set BEDROCK_MODEL_ID to one that exists in this region.`;
  }
  if (/Throttling|Too many requests/i.test(message)) {
    return 'Bedrock is throttling this account. Try the generation again in a moment.';
  }

  return message.slice(0, 500);
}

/** How many questions a run should write, given what was asked for. */
export function resolveQuestionCount(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_QUESTION_COUNT;
  return Math.max(MIN_QUESTIONS, Math.min(MAX_QUESTIONS, Math.trunc(raw)));
}

/** Which kinds of question a run should write, given what was asked for. */
export function resolveQuestionTypes(raw: unknown): QuestionType[] {
  const allowed: QuestionType[] = ['TRUE_FALSE', 'MULTIPLE_CHOICE'];
  if (!Array.isArray(raw)) return allowed;

  const types = allowed.filter((type) => raw.includes(type));
  return types.length > 0 ? types : allowed;
}

/**
 * The event that starts a run, and the two strings that route it.
 *
 * A custom source on the default bus rather than a direct Lambda invocation,
 * for the reason the rest of this service's background work uses events: the
 * rule that carries it is a thing you can look at, the target is a thing a
 * policy names, and the request that publishes it does not need to know the
 * function's name or ARN — which would otherwise be one more string in a shared
 * environment that is already a budget.
 */
export const GENERATION_EVENT_SOURCE = 'play.questions';
export const GENERATION_DETAIL_TYPE = 'Quiz Generation Requested';

/** What a queued run carries to the worker. */
export interface GenerationJobDetail {
  contentId: string;
  sourceContentId: string;
  count: number;
  types: QuestionType[];
  requestedBy: string;
  /** When the run was asked for, which is also what makes a delivery a duplicate. */
  requestedAt: number;
}

/**
 * How long a run may sit unfinished before it is treated as lost.
 *
 * The worker writes `RUNNING` when it starts and a result when it ends, so a
 * record left mid-flight means the invocation died — a timeout, an out-of-memory,
 * a deploy in the middle of it. Without this, that quiz could never be generated
 * for again: the one thing worse than a run that failed is a page that says one
 * is still going.
 */
export const GENERATION_STALE_MS = 15 * 60 * 1000;

/** Whether a run recorded on a quiz is one the author is still waiting for. */
export function isGenerationActive(
  generation: QuizGeneration | undefined,
  now = Date.now(),
): boolean {
  if (!generation) return false;
  if (generation.status !== 'QUEUED' && generation.status !== 'RUNNING') return false;

  const since = generation.startedAt ?? generation.requestedAt;
  return now - since < GENERATION_STALE_MS;
}

/**
 * Publishes a queued run.
 *
 * The detail is stringified because that is what EventBridge takes, and the
 * fields in it are the whole of what the worker is told: it reads the lesson
 * itself, so a long transcript never travels through an event.
 */
export async function publishGeneration(detail: GenerationJobDetail): Promise<void> {
  const res = await getEventBridgeClient().send(
    new PutEventsCommand({
      Entries: [
        {
          Source: GENERATION_EVENT_SOURCE,
          DetailType: GENERATION_DETAIL_TYPE,
          Detail: JSON.stringify(detail),
        },
      ],
    }),
  );

  // `PutEvents` answers 200 with the per-entry failures inside it, so a caller
  // that only checked the status code would report a run as queued when nothing
  // had been handed over.
  const failed = res.FailedEntryCount ?? 0;
  if (failed > 0) {
    const reason = res.Entries?.find((entry) => entry.ErrorCode)?.ErrorMessage ?? 'unknown error';
    throw new Error(`Could not queue the generation: ${reason}`);
  }
}

/**
 * Runs a queued generation, from start to record.
 *
 * Written to be run by an event and to never throw: a worker that fails loudly
 * is a worker whose failure is a CloudWatch entry nobody reads, and the author
 * waiting on the page is the person who needs to be told. Everything that goes
 * wrong is written onto the quiz's own `generation` record, which is what the
 * page is polling — so the failure arrives exactly where the progress would
 * have.
 *
 * Two guards matter before any work happens:
 *
 * - the quiz may have been deleted between the event and the invocation, which
 *   is not an error — there is simply nothing to write to;
 * - the record may name a *different* run, because a stale delivery of an
 *   earlier request arrived after a newer one. `requestedAt` is the identity of
 *   a run, and a duplicate is dropped rather than allowed to overwrite the
 *   newer run's questions with the older run's answer.
 */
export async function runGeneration(detail: GenerationJobDetail): Promise<void> {
  const quiz = await getContent(detail.contentId);
  if (!quiz) return;

  if (quiz.generation?.requestedAt !== detail.requestedAt) return;

  const running: QuizGeneration = {
    ...quiz.generation,
    status: 'RUNNING',
    startedAt: Date.now(),
  };
  await updateContent(quiz.contentId, { generation: running });

  try {
    const source = await getContent(detail.sourceContentId);
    if (!source) {
      throw new Error('The lesson these questions were to be written from no longer exists');
    }

    const lesson = await readLessonSource(source);
    if (!lesson.text.trim()) {
      throw new Error(
        'That lesson has nothing to write from yet — it needs subtitles or notes before questions can be made from it',
      );
    }

    const result = await generateQuestions(lesson, detail.count, detail.types);
    if (result.questions.length === 0) {
      throw new Error(
        result.rejected.length > 0
          ? `The model did not return a question that could be used (${result.rejected[0]})`
          : 'The model did not return any questions',
      );
    }

    const now = Date.now();
    let position = await nextQuestionPosition(quiz.contentId);

    for (const parsed of result.questions) {
      const question = toQuestionRow(
        {
          contentId: quiz.contentId,
          spaceId: quiz.spaceId,
          organizationId: quiz.organizationId,
          // The lesson they were written from rides on every question: the page
          // says where a question came from, and a quiz may draw on several.
          parsed: { ...parsed, sourceContentId: detail.sourceContentId },
          source: 'AI',
          position,
          createdBy: detail.requestedBy,
        },
        ulid(),
        now,
      );

      await putQuestion(question);
      position += 1;
    }

    await updateContent(quiz.contentId, {
      generation: {
        ...running,
        status: 'READY',
        finishedAt: Date.now(),
        created: result.questions.length,
        model: result.model,
      },
    });
  } catch (err) {
    console.error('Quiz generation failed', err);

    await updateContent(quiz.contentId, {
      generation: {
        ...running,
        status: 'FAILED',
        finishedAt: Date.now(),
        error: describeBedrockError(err),
      },
    });
  }
}
