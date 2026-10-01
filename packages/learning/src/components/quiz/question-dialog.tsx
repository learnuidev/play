'use client';

import { useEffect, useState } from 'react';
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/components/ui/dialog';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Textarea } from '@ui/components/ui/textarea';
import {
  useAddQuizQuestions,
  useCreateQuestion,
  useUpdateQuestion,
} from '@api/modules/question/question.queries';
import { BankPicker } from './bank-picker';
import { DifficultyPicker } from './difficulty-picker';
import { LessonPicker } from './lesson-picker';
import {
  DEFAULT_QUESTION_DIFFICULTY,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type QuestionDifficulty,
  type QuestionType,
  type QuizQuestion,
} from '@play/types';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MAX_PROMPT_LENGTH = 500;
const MAX_OPTION_LENGTH = 200;
const MAX_EXPLANATION_LENGTH = 1000;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

/** The option letters, in the order the API assigns them. */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Two empty options, which is the fewest a multiple-choice question can have. */
const blankOptions = () => ['', ''];

/**
 * Writing a question into a bank, or changing one.
 *
 * The same dialog in both directions, because the two are the same form: what
 * differs is whether the answers are already filled in.
 *
 * Two fields of it are the model rather than the form. **The bank** is where the
 * question will live — questions belong to banks, and a quiz only ever asks
 * them, so a question written from a quiz's page is written into a bank like any
 * other. **The lesson** is required: a question without one is a question nobody
 * can tell is still true, and it is the lesson that decides which course's quiz
 * may ask it.
 *
 * Five other decisions worth naming:
 *
 * - **The type is a pair of buttons, not a select.** There are two kinds and
 *   they are the whole of what the form does differently — a select would hide
 *   the choice behind a click and make the common case (leaving it alone) the
 *   only one that is easy.
 * - **The difficulty is a level, and the level's band is spelled out under it.**
 *   Easy, Medium, Hard and Expert mean a rate of correct answers and a way of
 *   writing; see `DifficultyPicker`. A new question starts at the default level,
 *   and a question that has none is left alone rather than silently graded the
 *   first time somebody fixes a typo in it.
 * - **The correct option is a radio per row**, which is how a question is
 *   written down on paper, and it is what makes "which one is right" one
 *   decision rather than a text field somebody can get wrong.
 * - **A true/false question has no options to edit.** Its two answers are True
 *   and False, spelled that way by the API, so the form says so rather than
 *   offering two fields that can only hold those words.
 * - **An edit is everywhere.** A question is shared, so the dialog says so
 *   before somebody changes one three quizzes are asking.
 */
export function QuestionDialog({
  orgId,
  bankId,
  spaceId,
  lessonContentId,
  question,
  addToContentId,
  open,
  onOpenChange,
}: {
  /** The organization whose banks and courses the pickers offer. */
  orgId: string;
  /** The bank it goes into. Omit to let the author choose one. */
  bankId?: string;
  /** The course whose lessons are on offer. Omit to let the author choose one. */
  spaceId?: string;
  /** The lesson to start on, when the page it was opened from knows one. */
  lessonContentId?: string;
  /** Omit to write a new one. */
  question?: QuizQuestion;
  /**
   * A quiz to add a newly written question to.
   *
   * Writing one *from a quiz* has to leave the quiz asking it: a question that
   * landed in a bank and nowhere else would look like nothing had happened, and
   * the author would go looking for it in a picker to add back what they had
   * just written.
   */
  addToContentId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pickedBankId, setPickedBankId] = useState('');
  const [lesson, setLesson] = useState('');
  const [type, setType] = useState<QuestionType>('MULTIPLE_CHOICE');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<string[]>(blankOptions());
  /** The right answer: an index into `options`, or 0 for True and 1 for False. */
  const [answer, setAnswer] = useState(0);
  const [explanation, setExplanation] = useState('');
  /**
   * How hard the question is meant to be.
   *
   * `undefined` for a question that has none — one written before levels
   * existed, or imported from a file without the column — and a *new* question
   * starts at the default rather than ungraded, so the common case needs no
   * decision. Leaving an old one alone is not a decision either: an ungraded
   * question stays ungraded unless the author picks a level, which is why the
   * patch below sends nothing when the two agree.
   */
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | undefined>(
    DEFAULT_QUESTION_DIFFICULTY,
  );

  const create = useCreateQuestion(bankId ?? pickedBankId);
  const update = useUpdateQuestion(question?.bankId);
  // Bound to the quiz only when there is one: a dialog opened from a bank has no
  // quiz to add to, and the hook is never asked to do anything in that case.
  const addToQuiz = useAddQuizQuestions(addToContentId ?? '');
  const pending = create.isPending || update.isPending || addToQuiz.isPending;

  const destinationBankId = bankId ?? pickedBankId;

  /**
   * Fills the form when it opens — and only then.
   *
   * The list underneath is refetched whenever a question is verified, edited or
   * added, so `question` is a new object on every one of those. Depending on it
   * here would reset the form under somebody mid-sentence, which is why the
   * dependency is the *identity* of the question rather than the row it came
   * from.
   */
  const questionId = question?.questionId;
  useEffect(() => {
    if (!open) return;

    setPickedBankId('');
    setLesson(question?.lessonContentId ?? lessonContentId ?? '');
    setType(question?.type ?? 'MULTIPLE_CHOICE');
    setPrompt(question?.prompt ?? '');
    setOptions(
      question && question.type === 'MULTIPLE_CHOICE'
        ? question.options.map((option) => option.text)
        : blankOptions(),
    );
    setAnswer(
      question
        ? Math.max(0, question.options.findIndex((option) => option.id === question.correctOptionIds[0]))
        : 0,
    );
    setExplanation(question?.explanation ?? '');
    // A new question starts at the default level; an existing one keeps whatever
    // it has, which for a question older than levels is nothing at all.
    setDifficulty(question ? question.difficulty : DEFAULT_QUESTION_DIFFICULTY);
  }, [open, questionId, lessonContentId]);

  const trimmedPrompt = prompt.trim();

  /** The options that were actually filled in, and where each came from. */
  const kept = options
    .map((text, index) => ({ text: text.trim(), index }))
    .filter((option) => option.text);

  const canSubmit =
    trimmedPrompt.length > 0 &&
    Boolean(lesson) &&
    (Boolean(bankId) || Boolean(pickedBankId)) &&
    !pending &&
    (type === 'TRUE_FALSE' || kept.length >= MIN_OPTIONS);

  function setOption(index: number, value: string) {
    setOptions((current) => current.map((option, position) => (position === index ? value : option)));
  }

  function removeOption(index: number) {
    setOptions((current) => current.filter((_, position) => position !== index));
    // The answer is a position in this list, so removing a row above it moves it
    // up by one — and removing the row that *is* the answer leaves the first one
    // selected rather than nothing at all.
    setAnswer((current) => (current === index ? 0 : current > index ? current - 1 : current));
  }

  async function submit() {
    // The answer follows the option it was put on: an option emptied in the
    // middle of the list compacts the ones after it, and the tick has to travel
    // with it rather than staying on a number.
    const answerAt = kept.findIndex((option) => option.index === answer);

    const answers = {
      type,
      prompt: trimmedPrompt,
      // A true/false question's options are the API's business: sending them
      // would be the same two words in a second spelling.
      ...(type === 'MULTIPLE_CHOICE'
        ? { options: kept.map((option) => option.text), answer: answerAt === -1 ? 0 : answerAt }
        : { answer: answer === 1 ? false : true }),
      explanation: explanation.trim(),
      ...(difficulty ? { difficulty } : {}),
    };

    try {
      if (question) {
        // The lesson is only sent when it has actually moved: an unchanged one
        // would be a write that takes the verification away for nothing. The
        // difficulty follows the same rule for a smaller reason: a level the
        // question already carries is not a change, and writing it again would
        // move `updatedAt` for nothing. Grading one does not take its
        // verification away — the question still asks what somebody read.
        await update.mutateAsync({
          questionId: question.questionId,
          patch: {
            ...answers,
            ...(lesson !== question.lessonContentId ? { lessonContentId: lesson } : {}),
            ...(difficulty !== question.difficulty ? { difficulty: difficulty ?? null } : {}),
          },
        });
        toast.success('Question saved', {
          description: 'It is the same question everywhere it is asked.',
        });
      } else {
        const { question: created } = await create.mutateAsync({ ...answers, lessonContentId: lesson });

        // Written from a quiz, so it is asked by that quiz from the moment it
        // exists. The question itself lives in the bank, as every question does.
        if (addToContentId) {
          await addToQuiz.mutateAsync([created.questionId]);
        }

        toast.success(addToContentId ? 'Question added to the quiz' : 'Question added');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the question');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{question ? 'Edit question' : 'New question'}</DialogTitle>
          <DialogDescription>
            {question
              ? 'Changing what the question asks, or the lesson it is about, takes its verification away — somebody will need to read it again.'
              : 'It is written into a bank, and every quiz asking it can be about any course that teaches the lesson.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!bankId && (
            <BankPicker orgId={orgId} value={pickedBankId} onChange={setPickedBankId} disabled={pending} />
          )}

          <LessonPicker
            orgId={orgId}
            spaceId={spaceId}
            value={lesson}
            onChange={setLesson}
            disabled={pending}
          />

          <div className="grid gap-2">
            <Label>Kind</Label>
            <div className="flex w-fit gap-0.5 rounded-full bg-muted/70 p-0.5">
              {QUESTION_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setType(option)}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-sm transition-colors',
                    type === option
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {QUESTION_TYPE_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <DifficultyPicker
            value={difficulty}
            onChange={setDifficulty}
            disabled={pending}
          />

          <div className="grid gap-2">
            <Label htmlFor="question-prompt">
              {type === 'TRUE_FALSE' ? 'Statement' : 'Question'}
            </Label>
            <Textarea
              id="question-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                type === 'TRUE_FALSE'
                  ? 'A 180-degree shutter angle is the cinematic standard.'
                  : 'What does a 180-degree shutter angle do to motion blur?'
              }
              maxLength={MAX_PROMPT_LENGTH}
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <Label>Answer</Label>

            {type === 'TRUE_FALSE' ? (
              <div className="flex gap-2">
                {['True', 'False'].map((label, index) => (
                  <Button
                    key={label}
                    type="button"
                    variant={answer === index ? 'default' : 'outline'}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setAnswer(index)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="grid gap-2">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    {/* The radio is the answer, and the letter beside it is the
                        option's own id — which is what a spreadsheet calls the
                        answer, so the form and the file agree. */}
                    <input
                      type="radio"
                      name="correct-option"
                      checked={answer === index}
                      onChange={() => setAnswer(index)}
                      aria-label={`Option ${LETTERS[index]} is correct`}
                      className="size-4 shrink-0 accent-foreground"
                    />
                    <span className="w-4 shrink-0 text-xs font-medium text-muted-foreground">
                      {LETTERS[index]}
                    </span>
                    <Input
                      value={option}
                      onChange={(event) => setOption(index, event.target.value)}
                      placeholder={`Option ${LETTERS[index]}`}
                      maxLength={MAX_OPTION_LENGTH}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground/60 hover:text-foreground"
                      onClick={() => removeOption(index)}
                      disabled={options.length <= MIN_OPTIONS}
                      aria-label={`Remove option ${LETTERS[index]}`}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}

                {options.length < MAX_OPTIONS && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-fit text-muted-foreground"
                    onClick={() => setOptions((current) => [...current, ''])}
                  >
                    <PlusIcon />
                    Add option
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="question-explanation">Explanation</Label>
            <Textarea
              id="question-explanation"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              placeholder="Why the answer is the answer. Read by whoever verifies it."
              maxLength={MAX_EXPLANATION_LENGTH}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {pending && <Loader2Icon className="animate-spin" />}
            {question ? 'Save question' : 'Add question'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
