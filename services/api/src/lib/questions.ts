import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type {
  QuestionOption,
  QuestionSource,
  QuestionStatus,
  QuestionType,
  QuizQuestion,
} from '../types';
import { QUESTION_STATUSES, QUESTION_TYPES } from '../types';
import { env } from './config';
import { documentClient as client } from './dynamodb';
import { HttpError } from './http';

export const QUESTIONS_TABLE = env.questionsTableName;

/**
 * A bank's questions, in order.
 *
 * A bank is what a question is read through: the bank's page lists them, an
 * import appends to them, and the quiz picker offers them. `position` is the
 * bank's to keep, which is why the index is bank-first.
 */
const BANK_POSITION_INDEX = 'BankPositionIndex';

/**
 * The questions about one lesson, across every bank.
 *
 * Read for exactly one thing, and it is a thing that cannot be avoided: deleting
 * a lesson. A question's lesson is required, so a question whose lesson is gone
 * is a question pointing at nothing — one that would still be offered to a quiz
 * in a course that no longer teaches what it asks about. The cascade reads this
 * index and takes them with it.
 */
const LESSON_INDEX = 'LessonIndex';

/**
 * The questions about one course, across every bank.
 *
 * Keyed by the lesson's course rather than by the lesson, because the question a
 * course page asks is "what has been written for *my* lessons" — one read rather
 * than one per lesson, and the grouping by lesson is done in the library where
 * the course's own order is known.
 */
const SPACE_INDEX = 'SpacePositionIndex';

/**
 * How many questions one bank will read at once.
 *
 * A ceiling rather than a limit anybody should meet: past it a bank is the
 * question bank of an institution, and reading it is one query per hundred.
 */
export const MAX_QUESTIONS_PER_BANK = 500;

/** How many option texts one multiple-choice question may offer. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

/** The option ids, in order: `a`, `b`, … A question never has more than six. */
const OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** The two options a true/false question has, in the order they are shown. */
export const TRUE_FALSE_OPTIONS: QuestionOption[] = [
  { id: 'a', text: 'True' },
  { id: 'b', text: 'False' },
];

export const MAX_PROMPT_LENGTH = 500;
export const MAX_EXPLANATION_LENGTH = 1000;

/**
 * A question that has been read and accepted: everything but its identity.
 *
 * This is what the create route, the importer and the generator all produce,
 * which is the point of it being a type of its own — a question typed by hand,
 * read out of a spreadsheet and written by a model all end up here, and
 * everything after it (ids, positions, statuses) is the same code.
 */
export interface ParsedQuestion {
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  correctOptionIds: string[];
  explanation?: string;
}

/** What a caller sent for one question. Everything is `unknown` until checked. */
export interface RawQuestionInput {
  type?: unknown;
  prompt?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
}

/**
 * Reads a question, or says why it cannot be read.
 *
 * Returns its refusal rather than throwing it, and that is the whole reason the
 * validator is a function of its own: the create route turns a refusal into a
 * 400, and an import turns it into *one bad row* — a file of fifty questions
 * with a typo in the thirty-first must import the forty-nine that are fine and
 * name the row that was not.
 *
 * The rules, in one place:
 *
 * - a `TRUE_FALSE` question's options are *always* "True" and "False"; whatever
 *   a caller sends for them is ignored, because two ways to spell the same two
 *   answers is a question that renders differently depending on who wrote it;
 * - a `MULTIPLE_CHOICE` question has two to six options, none empty and none
 *   the same as another;
 * - the answer is one option, addressed by letter (`A`), by its own text, or by
 *   a zero-based index — the three things a spreadsheet column, a person and a
 *   model respectively produce.
 */
export function parseQuestionInput(
  raw: RawQuestionInput,
): { question: ParsedQuestion } | { error: string } {
  const type = readQuestionType(raw.type);
  if (typeof type !== 'string') return type;

  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim().replace(/\s+/g, ' ') : '';
  if (!prompt) return { error: 'prompt is required' };
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { error: `prompt must be <= ${MAX_PROMPT_LENGTH} characters` };
  }

  const texts = type === 'TRUE_FALSE' ? TRUE_FALSE_OPTIONS.map((option) => option.text) : readOptionTexts(raw.options);
  if (!Array.isArray(texts)) return texts;

  if (type === 'MULTIPLE_CHOICE') {
    const seen = new Set(texts.map((text) => text.toLowerCase()));
    if (seen.size !== texts.length) return { error: 'options must all be different' };
  }

  const options: QuestionOption[] = texts.map((text, index) => ({ id: OPTION_IDS[index], text }));

  const answer = readAnswer(raw.answer, options, type);
  if (!('id' in answer)) return answer;

  let explanation: string | undefined;
  if (raw.explanation !== undefined && raw.explanation !== null && raw.explanation !== '') {
    if (typeof raw.explanation !== 'string') return { error: 'explanation must be a string' };
    explanation = raw.explanation.trim().slice(0, MAX_EXPLANATION_LENGTH);
    if (!explanation) explanation = undefined;
  }

  return {
    question: {
      type,
      prompt,
      options,
      correctOptionIds: [answer.id],
      ...(explanation ? { explanation } : {}),
    },
  };
}

/**
 * The question type, or the sentence saying which values are allowed.
 *
 * Every reader in this file answers in one of two shapes — the value, or the
 * refusal — rather than throwing and rather than returning a sentinel, because
 * a `string` that means either an option id or an error message is a string
 * nothing can tell apart. See `parseQuestionInput`.
 */
function readQuestionType(raw: unknown): QuestionType | { error: string } {
  if (typeof raw !== 'string') {
    return { error: `type is required, one of ${QUESTION_TYPES.join(', ')}` };
  }

  // A spreadsheet is written by a person, so the cells are read leniently:
  // "multiple choice", "choice", "mc" and "multiple-choice" are one value.
  const normalized = raw.trim().toUpperCase().replace(/[\s\-/]+/g, '_');
  if (normalized === 'TF' || normalized === 'TRUE_FALSE' || normalized === 'TRUEFALSE') {
    return 'TRUE_FALSE';
  }
  if (normalized === 'MC' || normalized === 'MULTIPLE_CHOICE' || normalized === 'MULTIPLECHOICE') {
    return 'MULTIPLE_CHOICE';
  }

  return { error: `type must be one of ${QUESTION_TYPES.join(', ')} (got "${raw.trim()}")` };
}

/** The option texts of a multiple-choice question, or the reason there are none. */
function readOptionTexts(raw: unknown): string[] | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: 'options is required and must be a list of texts' };
  }

  const texts = raw.map((option) => {
    if (typeof option === 'string') return option.trim().replace(/\s+/g, ' ');
    // An option that arrives as an object is a serialized `QuestionOption` —
    // what an export of this API looks like — so its text is the text.
    if (option && typeof option === 'object' && typeof (option as QuestionOption).text === 'string') {
      return (option as QuestionOption).text.trim().replace(/\s+/g, ' ');
    }
    return '';
  });

  const empty = texts.findIndex((text) => !text);
  if (empty !== -1) return { error: `option ${OPTION_IDS[empty]?.toUpperCase() ?? empty + 1} is empty` };
  if (texts.length < MIN_OPTIONS) return { error: `options must have at least ${MIN_OPTIONS}` };
  if (texts.length > MAX_OPTIONS) return { error: `options must have at most ${MAX_OPTIONS}` };
  return texts;
}

/**
 * Which option answers the question.
 *
 * Letters first, because that is what the import template asks for and a letter
 * cannot be mistaken for anything else; then an exact (case-insensitive) match
 * on an option's text; then a zero-based index. Numbers are deliberately *not*
 * treated as one-based when they fall outside the range: guessing that a `4`
 * among four options means the last one would silently answer a question the
 * wrong way round, and a row that fails says so instead.
 */
function readAnswer(
  raw: unknown,
  options: QuestionOption[],
  type: QuestionType,
): { id: string } | { error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'answer is required' };
  }

  if (typeof raw === 'boolean') {
    if (type !== 'TRUE_FALSE') return { error: 'answer must name one of the options' };
    return { id: raw ? 'a' : 'b' };
  }

  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0 || raw >= options.length) {
      return { error: `answer must be an index between 0 and ${options.length - 1}` };
    }
    return { id: options[raw].id };
  }

  if (typeof raw !== 'string') return { error: 'answer must be a letter, an option, or an index' };

  const value = raw.trim();
  if (!value) return { error: 'answer is required' };

  if (value.length === 1) {
    const index = OPTION_IDS.indexOf(value.toLowerCase());
    if (index !== -1 && index < options.length) return { id: options[index].id };
  }

  const asWord = value.toLowerCase();
  if (type === 'TRUE_FALSE') {
    if (asWord === 'true' || asWord === 't' || asWord === 'yes') return { id: 'a' };
    if (asWord === 'false' || asWord === 'f' || asWord === 'no') return { id: 'b' };
  }

  const match = options.find((option) => option.text.toLowerCase() === asWord);
  if (match) return { id: match.id };

  return { error: `answer "${value}" is not one of the options` };
}

export async function putQuestion(question: QuizQuestion): Promise<void> {
  await client.send(new PutCommand({ TableName: QUESTIONS_TABLE, Item: question }));
}

export async function getQuestion(questionId: string): Promise<QuizQuestion | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: QUESTIONS_TABLE, Key: { questionId } }),
  );
  return res.Item as QuizQuestion | undefined;
}

export async function deleteQuestionItem(questionId: string): Promise<void> {
  await client.send(new DeleteCommand({ TableName: QUESTIONS_TABLE, Key: { questionId } }));
}

/**
 * Every question in one bank, in the order it holds them.
 *
 * Read whole rather than paged, because a bank is a list somebody works down:
 * the page groups them by lesson, and both things it says — what is in here, and
 * how much of it nobody has verified — are answers about all of it. The ceiling
 * is `MAX_QUESTIONS_PER_BANK`, and the loop stops there.
 */
export async function listQuestionsByBank(bankId: string): Promise<QuizQuestion[]> {
  const questions: QuizQuestion[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: QUESTIONS_TABLE,
        IndexName: BANK_POSITION_INDEX,
        KeyConditionExpression: '#bankId = :bankId',
        ExpressionAttributeNames: { '#bankId': 'bankId' },
        ExpressionAttributeValues: { ':bankId': bankId },
        ScanIndexForward: true,
        Limit: 100,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    questions.push(...((res.Items ?? []) as QuizQuestion[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey && questions.length < MAX_QUESTIONS_PER_BANK);

  // The index orders by position, but two questions written at the same moment
  // can share one, and an order that depends on which of them DynamoDB returns
  // first is an order that changes under the reader. The key breaks the tie.
  return questions.sort((a, b) => a.position - b.position || a.questionId.localeCompare(b.questionId));
}

/** One question's position, one past the last in its bank. */
export async function nextQuestionPosition(bankId: string): Promise<number> {
  const res = await client.send(
    new QueryCommand({
      TableName: QUESTIONS_TABLE,
      IndexName: BANK_POSITION_INDEX,
      KeyConditionExpression: '#bankId = :bankId',
      ExpressionAttributeNames: { '#bankId': 'bankId' },
      ExpressionAttributeValues: { ':bankId': bankId },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );

  const last = (res.Items ?? [])[0] as QuizQuestion | undefined;
  return (last?.position ?? 0) + 1;
}

/**
 * Every question about one lesson, from every bank.
 *
 * Read by the cascade that follows a deleted lesson, which is the one caller
 * that cannot afford to miss a question: what it does not find goes on being
 * offered to quizzes about a lesson nobody can open any more.
 */
export async function listQuestionsByLesson(lessonContentId: string): Promise<QuizQuestion[]> {
  const questions: QuizQuestion[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: QUESTIONS_TABLE,
        IndexName: LESSON_INDEX,
        KeyConditionExpression: '#lessonContentId = :lessonContentId',
        ExpressionAttributeNames: { '#lessonContentId': 'lessonContentId' },
        ExpressionAttributeValues: { ':lessonContentId': lessonContentId },
        Limit: 100,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    questions.push(...((res.Items ?? []) as QuizQuestion[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return questions;
}

/**
 * Every question about a course's lessons, from every bank, in one read.
 *
 * Read whole, like a bank's: a course page draws all of them at once, grouped by
 * the lesson they are about, and the ceiling is `MAX_QUESTIONS_PER_BANK` for the
 * same reason — past it a page is a report rather than a list somebody works
 * down.
 */
export async function listQuestionsBySpace(spaceId: string): Promise<QuizQuestion[]> {
  const questions: QuizQuestion[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: QUESTIONS_TABLE,
        IndexName: SPACE_INDEX,
        KeyConditionExpression: '#lessonSpaceId = :lessonSpaceId',
        ExpressionAttributeNames: { '#lessonSpaceId': 'lessonSpaceId' },
        ExpressionAttributeValues: { ':lessonSpaceId': spaceId },
        ScanIndexForward: true,
        Limit: 100,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    questions.push(...((res.Items ?? []) as QuizQuestion[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey && questions.length < MAX_QUESTIONS_PER_BANK);

  return questions.sort((a, b) => a.position - b.position || a.questionId.localeCompare(b.questionId));
}

/**
 * One question's lesson, checked rather than taken on trust.
 *
 * A question names the lesson it is about, and that lesson has to *be* a lesson:
 * not a note, not another quiz. It also has to belong to the caller's own
 * organization, which is what stops a stray id from pointing a question at
 * another organization's course.
 */
export function assertLesson(
  lesson: { type: string; organizationId: string } | undefined,
  organizationId: string,
): asserts lesson is { type: string; organizationId: string } {
  if (!lesson) throw new HttpError(400, 'That lesson does not exist');
  if (lesson.organizationId !== organizationId) {
    throw new HttpError(400, 'lessonContentId must be a lesson of this organization');
  }
  if (lesson.type !== 'VIDEO') {
    throw new HttpError(400, 'A question is associated with a lesson, not with a quiz');
  }
}

export interface QuestionStatusChange {
  status: QuestionStatus;
  /** Absent when a question goes back to being unverified. */
  verifiedBy?: string;
  verifiedAt?: number;
}

/**
 * Writes a question's status, and who decided it.
 *
 * Unverifying *removes* the two verification attributes rather than setting
 * them to an empty string: "nobody has checked this" is the absence of the
 * record, and a row carrying `verifiedBy: ''` is a row that has to be read
 * carefully to be understood.
 */
export async function updateQuestionStatus(
  questionId: string,
  change: QuestionStatusChange,
): Promise<void> {
  if (!QUESTION_STATUSES.includes(change.status)) {
    throw new HttpError(400, 'Unsupported question status');
  }

  const verify = change.status === 'VERIFIED';
  await client.send(
    new UpdateCommand({
      TableName: QUESTIONS_TABLE,
      Key: { questionId },
      UpdateExpression: verify
        ? 'SET #status = :status, verifiedBy = :verifiedBy, verifiedAt = :verifiedAt, updatedAt = :updatedAt'
        : 'SET #status = :status, updatedAt = :updatedAt REMOVE verifiedBy, verifiedAt',
      // `status` is a reserved word in DynamoDB's expression grammar.
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: verify
        ? {
            ':status': change.status,
            ':verifiedBy': change.verifiedBy,
            ':verifiedAt': change.verifiedAt,
            ':updatedAt': Date.now(),
          }
        : { ':status': change.status, ':updatedAt': Date.now() },
    }),
  );
}

/** One field of a question, as an edit writes it. */
export interface UpdateQuestionPatch {
  type?: QuestionType;
  prompt?: string;
  options?: QuestionOption[];
  correctOptionIds?: string[];
  /** Pass `null` to clear the explanation. */
  explanation?: string | null;
  /** Move it to another lesson — which is also a change to what it is about. */
  lessonContentId?: string;
  lessonSpaceId?: string;
  position?: number;
  /**
   * Whether the edit is the kind that invalidates a verification.
   *
   * Changing a question's words, its answer, or the lesson it is about does — a
   * person verified *that text about that lesson*, and a question that has since
   * been rewritten, or moved to another lesson, is one nobody has read. Moving
   * it down a list does not, and neither does fixing a typo in the explanation,
   * which is why the caller says which it is: only the code that knows what
   * changed can tell.
   */
  invalidateVerification?: boolean;
}

/**
 * Edits a question in place.
 *
 * The same shape as the content patch beside it: only the fields present are
 * written, and a `null` is a REMOVE rather than a value DynamoDB cannot store.
 */
export async function updateQuestion(
  questionId: string,
  patch: UpdateQuestionPatch,
): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': Date.now() };
  let set = 'SET updatedAt = :updatedAt';
  let remove = '';

  const assign = (field: string, value: unknown) => {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    set += `, #${field} = :${field}`;
  };

  if (patch.type !== undefined) assign('type', patch.type);
  if (patch.prompt !== undefined) assign('prompt', patch.prompt);
  if (patch.options !== undefined) assign('options', patch.options);
  if (patch.correctOptionIds !== undefined) assign('correctOptionIds', patch.correctOptionIds);
  if (patch.position !== undefined) assign('position', patch.position);
  if (patch.lessonContentId !== undefined) assign('lessonContentId', patch.lessonContentId);
  if (patch.lessonSpaceId !== undefined) assign('lessonSpaceId', patch.lessonSpaceId);

  if (patch.explanation !== undefined) {
    if (patch.explanation === null) {
      names['#explanation'] = 'explanation';
      remove = ', #explanation';
    } else {
      assign('explanation', patch.explanation);
    }
  }

  if (patch.invalidateVerification) {
    // Back to a draft, and the verification record goes with it: a question
    // nobody has read must not carry the name of somebody who read an earlier
    // version of it.
    assign('status', 'NEEDS_VERIFICATION' satisfies QuestionStatus);
    names['#verifiedBy'] = 'verifiedBy';
    names['#verifiedAt'] = 'verifiedAt';
    remove += ', #verifiedBy, #verifiedAt';
  }

  const expression = remove ? `${set} REMOVE ${remove.slice(2)}` : set;

  await client.send(
    new UpdateCommand({
      TableName: QUESTIONS_TABLE,
      Key: { questionId },
      UpdateExpression: expression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** What a question is created as, before it is given an id. */
export interface NewQuestion {
  bankId: string;
  organizationId: string;
  lessonContentId: string;
  lessonSpaceId: string;
  parsed: ParsedQuestion;
  source: QuestionSource;
  position: number;
  createdBy: string;
}

/**
 * The row a parsed question becomes.
 *
 * `NEEDS_VERIFICATION` is not a parameter: nothing in this service creates a
 * verified question, because verifying is an act somebody performs on a question
 * they have read, and a code path that could create one already verified would
 * be a way for a machine's guess to reach a learner with nobody in between.
 */
export function toQuestionRow(input: NewQuestion, questionId: string, now: number): QuizQuestion {
  return {
    questionId,
    bankId: input.bankId,
    organizationId: input.organizationId,
    lessonContentId: input.lessonContentId,
    lessonSpaceId: input.lessonSpaceId,
    type: input.parsed.type,
    prompt: input.parsed.prompt,
    options: input.parsed.options,
    correctOptionIds: input.parsed.correctOptionIds,
    ...(input.parsed.explanation ? { explanation: input.parsed.explanation } : {}),
    status: 'NEEDS_VERIFICATION',
    source: input.source,
    position: input.position,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

/** How many of these questions are still waiting for somebody to read them. */
export function countNeedingVerification(questions: QuizQuestion[]): number {
  return questions.filter((question) => question.status === 'NEEDS_VERIFICATION').length;
}

/**
 * Writes positions 1..n over a list, touching only the rows whose position
 * actually changed.
 *
 * Rows that did not move are left alone: rewriting all of them every time is
 * both more writes than the move needs and a larger window in which a reader
 * sees a half-applied order.
 */
export async function renumberQuestions(questions: QuizQuestion[]): Promise<void> {
  for (const [index, question] of questions.entries()) {
    const position = index + 1;
    if (question.position === position) continue;
    await updateQuestion(question.questionId, { position });
  }
}
