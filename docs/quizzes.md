# Quizzes and questions

A course can now check what it taught. A **quiz** is a piece of content — a row in
a section, beside the lessons, sorted with them — and what it holds is
**questions**: true/false, or multiple choice with one right answer.

Questions arrive three ways: written by hand, imported from a spreadsheet or a
JSON file, or written by a model from a lesson's transcript and notes. Everything
a *machine* produced arrives as a draft, and only a person can make it live.

This file is the map: the model, the routes, the two flows that are more than CRUD,
and the one thing that has to be done by hand.

## The model, and why questions have a table

| What | Where |
| --- | --- |
| A quiz | `ContentsTable`, `type: 'QUIZ'` — the same row a lesson is |
| A question | `QuestionsTable`, keyed by `questionId`, indexed by `contentId` + `position` |
| A generation run | the quiz's own content row, in `generation` |

A quiz is content rather than a new kind of thing for the reason the outline is
worth keeping simple: a course's shape is a list of sections holding a list of
items, and a second kind of item that lives somewhere else would be a second
outline, a second ordering, and a second set of access rules that have to agree
with the first.

Questions are a table of their own for the reason a lesson's attachments are:
each one is written, verified, reordered and deleted *on its own*, and a list
stored inside the content row would make every one of those a rewrite of the
whole quiz — two authors would overwrite each other, and a long quiz would be
400 KB away from not saving at all.

A question carries `contentId`, `spaceId` and `organizationId`, the same way a
lesson carries its section and its organization: one read then authorizes it.

## Status: a draft, until a person says otherwise

```ts
type QuestionStatus = 'NEEDS_VERIFICATION' | 'VERIFIED';
```

Every question created by the API starts `NEEDS_VERIFICATION`, and there is no
parameter anywhere that creates one verified — see `toQuestionRow` in
`services/api/src/lib/questions.ts`, where the status is not an argument. A code
path that could create a verified question would be a way for a machine's guess
to reach a learner with nobody in between, and that is the one failure this
feature exists to prevent.

- **A person verifies one question** by reading it: `PUT
  /questions/{questionId}/verification` records *who* and *when*, so a question
  that marked somebody wrong can be traced to whoever read it and agreed.
  `DELETE` on the same route takes it back, and removes the record: "nobody has
  checked this" is the absence of the fact, not blank fields.
- **A batch can be accepted** — `POST
  /contents/{contentId}/questions/verification` — with `questionIds`, or with
  nothing at all meaning *every question of this quiz that is still waiting*. It
  refuses ids that are not this quiz's, because a route that quietly verified a
  subset somebody did not name is a route that undoes a reviewer's work.
- **Editing what a question asks takes its verification away.** Somebody said
  "this is right" about a sentence; a sentence that has changed is one nobody has
  said anything about. Fixing a typo in the *explanation*, or moving the question
  down the list, does not — see `UpdateQuestionPatch.invalidateVerification`.
- **A wrong question is deleted, not marked.** There is no `REJECTED` status: a
  question that is not to be asked is not a state to keep it in, and one that was
  kept would be one somebody has to explain later.

## Writing questions from a lesson, with Bedrock

`POST /contents/{contentId}/questions/generation` starts a run. It answers `202`
with the quiz — not with questions, and that is the point of the design.

**A model call does not fit in a request.** API Gateway holds a REST request open
for 29 seconds at the very most, and a model reading a lesson transcript and
writing ten questions routinely takes longer. So:

```
POST …/questions/generation   → writes generation { QUEUED } on the quiz
                              → publishes an EventBridge event (play.questions)
                              → answers 202 with the quiz
EventBridge rule              → invokes play-<stage>-generate-questions
worker                        → RUNNING … questions written … READY | FAILED
quiz page                     → polls GET /contents/{contentId} until it is over
```

What the model is given is the lesson's **transcript** (the WebVTT Transcribe
wrote, cut down to words) and its **notes** (a ProseMirror document flattened to
text). A lesson with neither has nothing to write from, and the route says so
before queueing anything.

Everything the model returns goes through `parseQuestionInput` — the same
validator a typed question and an imported row go through — and a question that
does not hold up is dropped rather than retried. A run that writes eight good
questions and two malformed ones has done its job.

### The model, and the two things it needs

`BEDROCK_MODEL_ID` names the model, and it is set **per function** (only the
worker is given it), so it costs nothing from the shared environment budget:

```
us.amazon.nova-lite-v1:0        # the default: an Amazon model, no access request needed
us.anthropic.claude-3-5-haiku-20241022-v1:0
```

The call is Bedrock's `Converse`, which is the model-agnostic API — the same
request body reaches an Amazon, Anthropic or Meta model — so choosing a model is
that string and nothing else.

Two things have to be true in the account, and neither is a deploy:

1. **Model access must be enabled** in the Bedrock console for the region. A
   refusal comes back as a `ValidationException`; `describeBedrockError` turns it
   into a sentence naming the model and the console.
2. **The shared execution role must be allowed to invoke it**, which it is:
   `bedrock:InvokeModel` (with `Resource: '*'`, because a model is not an ARN in
   your account and a cross-region inference profile is served from another
   region) is granted in `infra/src/stacks/api-stack.ts`.

### Runs that die, and runs that are re-asked

A run is identified by `requestedAt`. The worker refuses to write for a run whose
record has changed, so a duplicate delivery of an old event cannot overwrite a
newer run's questions. A run left `QUEUED`/`RUNNING` for longer than
`GENERATION_STALE_MS` (15 minutes) is treated as dead — a quiz nobody can
generate for again because a record says something is still going is worse than
one that has to be asked twice.

## Importing a file

`POST /contents/{contentId}/questions/import` takes the file **base64 inside a
JSON body** (`{ fileName, contentBase64, sourceContentId? }`) — API Gateway's REST
integration has no multipart parser, and a file that has been base64'd is a
string, which is what this service already knows how to take.

| Format | Notes |
| --- | --- |
| `.xlsx` | The first sheet. Read with `read-excel-file`; legacy `.xls` is refused, because it is a different format entirely and the only sane advice is "save it as .xlsx" |
| `.csv` / `.tsv` | Delimiter sniffed from the first line (`,` `\t` `;`) |
| `.json` | An array, or `{ "questions": [...] }` |

Columns are read by their headings, and the spelling is forgiving: `Type`/`Kind`,
`Question`/`Prompt`/`Text`, `Option A`…`Option F` (or `A`…`F`, `Choice A`,
`answer_a`), `Answer`/`Correct`/`Correct Answer`, `Explanation`/`Rationale`/`Why`.

- **The type may be left out.** A row with options filled in is multiple choice;
  a row without them is true/false. That is what lets a two-column sheet —
  question, answer — import as it was written.
- **The answer is a letter** (`A`), an option's own text (`1789`), or a
  zero-based index. `TRUE`/`FALSE`, `T`/`F`, `yes`/`no` and a real boolean cell
  all work for a true/false question. A number outside the options is *refused*
  rather than guessed at as one-based — guessing there answers a question the
  wrong way round.
- **A bad row is reported, not thrown.** A file of fifty questions with a typo in
  the thirty-first imports the forty-nine and answers with the lines that were
  not read (`skipped: [{ row, error }]`). Only a file-level failure — the wrong
  kind of file, one that will not parse at all, more than `MAX_IMPORT_ROWS` (300)
  or `MAX_IMPORT_BYTES` (4 MB) — fails the whole request.
- **Everything imported lands needing verification**, like everything generated:
  the file came from somewhere else, and nobody here has read it.

The template is generated rather than shipped as a file — `importTemplateCsv()`
in `services/api/src/lib/question-import.ts`, and the studio's own copy for the
download button — because the headings are the parser's contract, and a template
that drifted from the parser would be a template whose imports fail. The studio
can also export the questions it is showing, as CSV or JSON, which is how the
format gets used by the people who have to live with it.

## Ordering: what a drag actually sends

Moving a lesson, a quiz or a question is `PUT …/placement` with a **place**, not
an order:

```jsonc
// PUT /contents/{contentId}/placement     a lesson or a quiz
{ "sectionId": "01H…", "index": 2 }        // sectionId is optional: omit to reorder in place

// PUT /questions/{questionId}/placement   a question inside its quiz
{ "index": 3 }
```

`index` is zero-based, in the target container, counted **after** the moved row is
taken out of it — which is exactly the position it ends up in, and what
`arrayMove` produces on the page. The server turns that place into positions by
renumbering only the rows that actually moved.

Why a place rather than a list of ids: the page that drew the outline cannot know
what has been added to it since, and a client that sent a whole order would be a
client that can silently delete a lesson somebody else added while the drag was in
flight. Two people arranging one course is not a hypothetical.

The write is a sequence of single-item updates, not a transaction. Part way
through, the worst case is two rows sharing a position — which the listings break
by id — so the list is momentarily odd to look at and nothing is lost.

## Routes

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/contents/{contentId}/questions` | A quiz's questions, in order, with how many need verifying |
| POST | `/contents/{contentId}/questions` | Write one by hand |
| POST | `/contents/{contentId}/questions/import` | Import a file |
| POST | `/contents/{contentId}/questions/generation` | Queue an AI generation |
| POST | `/contents/{contentId}/questions/verification` | Accept a batch |
| PATCH | `/questions/{questionId}` | Change it (takes its verification away) |
| DELETE | `/questions/{questionId}` | Remove it |
| PUT | `/questions/{questionId}/verification` | Verify it |
| DELETE | `/questions/{questionId}/verification` | Take that back |
| PUT | `/questions/{questionId}/placement` | Move it inside its quiz |
| PUT | `/contents/{contentId}/placement` | Move a lesson or a quiz within / between sections |
| — | (event) | `play.questions` / `Quiz Generation Requested` → `generate-questions` |

**Every one of these authorizes as a write on the quiz**, including the reads:
a question's response carries the answer key, and there is no reader of it who is
not editing the quiz. A learner who may read the lesson a quiz sits in cannot
fetch its answers. `requireQuizAccess` is where that is decided, and the day a
quiz can be *taken* is the day a separate route hands out questions without the
answers — a route, and a decision, this one deliberately does not pre-empt.

## The one thing to do by hand

`QuestionsTable` is the first table added since the migration, so it is the first
that is not an adopted legacy resource. The data stack imports tables rather than
creating them (`ownership.tables` is false, and turning it on would try to create
all twenty-three under new names), so **this table is created by a script, once
per stage, before the first deploy**:

```bash
node infra/scripts/create-questions-table.mjs --plan   # what it would create
node infra/scripts/create-questions-table.mjs --yes    # create it
```

It reads the key schema out of `infra/src/generated/service.ts` rather than
carrying its own copy — one description of the table, and the one the stacks
deploy against — turns on point-in-time recovery, and writes the physical name
into `infra/config/play-<stage>.json` under `existing.tables.QuestionsTable`,
which is the name the data stack imports it by. It is idempotent: run it again
and it reports what it finds.

## What is not built

- **Nobody takes a quiz yet.** No attempts, no answers recorded, no marking, no
  score. The marketplace says so on the page rather than pretending: a quiz opens
  as "This quiz cannot be taken yet". The questions and the review around them
  are the whole of this feature.
- **No "select all that apply".** A question has exactly one right answer.
  `correctOptionIds` is an array because that is the shape a second kind would
  need, so adding one is a change to validation rather than to storage.
- **No per-course review queue.** Questions are reviewed on the quiz's own page:
  the table is indexed by quiz, and a course-wide "everything nobody has read" is
  a read this table cannot serve. If that screen is ever wanted, it is an index
  on `organizationId` + `status` and a route, not a rewrite.

## Where the code is

| What | Where |
| --- | --- |
| The question row, its validator, ordering, verification | `services/api/src/lib/questions.ts` |
| Reading a lesson's words, the prompt, the Bedrock call, the queue | `services/api/src/lib/quiz-generation.ts` |
| Reading a sheet, a CSV or a JSON file into questions | `services/api/src/lib/question-import.ts` |
| The order arithmetic both drags share | `services/api/src/lib/placement.ts` |
| The routes | `services/api/src/functions/questions/*`, `functions/contents/place-content.ts` |
| Creating the table | `infra/scripts/create-questions-table.mjs` |
| The question editor, the AI dialog, the import dialog, the list | `packages/learning/src/components/quiz/*` |
| The quiz page, and the lesson action that makes one | `apps/studio/src/components/quiz/quiz-page.tsx`, `packages/learning/src/classroom.tsx` |
| The client and its cache | `packages/api/src/modules/question/question.queries.ts` |
