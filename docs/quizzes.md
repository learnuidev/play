# Quizzes and question banks

A course can check what it taught. Two records make that work, and the split
between them is the design:

```
QuestionBank ─── Question ─── Lesson (a VIDEO content)
                    │
                    └── QuizQuestionLink ─── Quiz (a QUIZ content)
```

- A **question** belongs to a **bank** and is **about a lesson**. That is the
  rule: a question without a lesson is a question nobody can tell is still true —
  the lesson is re-recorded, the words that made the question correct change, and
  the question goes on being asked.
- A **quiz** does not own questions. It *asks* them: a link row per question, and
  a position saying where in the order a learner meets it. So one question,
  written once and read once, can be asked by a quiz in this course, by a retake,
  and by next term's version of the same course.
- A **bank** belongs to an **organization** rather than to a course, because a
  question is about a *lesson*: a course-shaped bank would mean writing the same
  question again the moment two courses shared a lesson's subject.

That is what makes the model worth its three tables: **the bank is a library, the
quiz is a selection, and the lesson is the thread that ties a question to
something that can change under it.**

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
  `DELETE` takes it back and removes the record: "nobody has checked this" is the
  absence of the fact, not blank fields.
- **Verifying is once, wherever it is done.** A question is shared, so verifying
  it from a bank's page or from a quiz's page is the same act on the same row.
  Two batch routes exist — one per bank, one per quiz — and both write the same
  thing; they differ only in *which* questions they default to.
- **Editing what a question asks, or the lesson it is about, takes its
  verification away.** Somebody said "this is right" about a sentence and a
  lesson, and one that has changed since is one nobody has said anything about.
  Fixing a typo in the *explanation* does not — see
  `UpdateQuestionPatch.invalidateVerification`.
- **A wrong question is deleted, not marked.** There is no `REJECTED` status: a
  question that is not to be asked is not a state to keep it in. Deleting one
  from its bank also removes it from every quiz asking it, and the answer says
  how many that was.

## Writing questions into a bank

Three ways in, and all three require the lesson:

| Way | Route | Notes |
| --- | --- | --- |
| By hand | `POST /banks/{bankId}/questions` | `lessonContentId` is required |
| From a file | `POST /banks/{bankId}/questions/import` | one file, one lesson |
| From a model | `POST /banks/{bankId}/questions/generation` | reads the lesson's transcript and notes |

### Generation, and why it is queued

**A model call does not fit in a request.** API Gateway holds a REST request open
for 29 seconds at the very most, and a model reading a lesson transcript and
writing ten questions routinely takes longer. So:

```
POST …/questions/generation   → writes generation { QUEUED } on the BANK
                              → publishes an EventBridge event (play.questions)
                              → answers 202 with the bank
EventBridge rule              → invokes play-<stage>-generate-questions
worker                        → RUNNING … questions written … READY | FAILED
bank page                     → polls GET /banks/{bankId} until it is over
```

The run rides on the **bank** rather than on the quiz, because that is where the
questions go: a quiz that asked for one may be gone by the time they arrive, and
the questions are not. `addToContentId` — set when the run was started from a
quiz, or by the "generate a quiz from this lesson" shortcut — makes the worker
also add what it wrote to that quiz, which is what turns the shortcut into one
click.

What the model is given is the lesson's **transcript** (the WebVTT Transcribe
wrote, cut down to words) and its **notes** (a ProseMirror document flattened to
text). A lesson with neither has nothing to write from, and the route refuses
before queueing anything. Everything the model returns goes through
`parseQuestionInput` — the same validator a typed question and an imported row go
through — and a question that does not hold up is dropped rather than retried.

`BEDROCK_MODEL_ID` names the model, set **per function** (only the worker is
given it), so it costs nothing from the shared environment budget:

```
us.amazon.nova-lite-v1:0        # the default: an Amazon model, no access request needed
us.anthropic.claude-3-5-haiku-20241022-v1:0
```

The call is Bedrock's `Converse`, which is the model-agnostic API — the same
request body reaches an Amazon, Anthropic or Meta model — so choosing a model is
that string and nothing else. Two things have to be true in the account, and
neither is a deploy: **model access must be enabled** for the region (a refusal
arrives as a `ValidationException`, and `describeBedrockError` turns it into a
sentence naming the model and the console), and **the shared execution role must
be allowed to invoke it**, which it is.

### Importing a file

`POST /banks/{bankId}/questions/import` takes the file **base64 inside a JSON
body** (`{ fileName, contentBase64, lessonContentId }`) — API Gateway's REST
integration has no multipart parser, and a file that has been base64'd is a
string, which is what this service already knows how to take.

| Format | Notes |
| --- | --- |
| `.xlsx` | The first sheet. Read with `read-excel-file`; legacy `.xls` is refused, because it is a different format entirely and the only sane advice is "save it as .xlsx" |
| `.csv` / `.tsv` | Delimiter sniffed from the first line (`,` `\t` `;`) |
| `.json` | An array, or `{ "questions": [...] }` |

Columns are read by their headings, forgivingly: `Type`/`Kind`,
`Question`/`Prompt`/`Text`, `Option A`…`Option F` (or `A`…`F`, `Choice A`,
`answer_a`), `Answer`/`Correct`/`Correct Answer`, `Explanation`/`Rationale`/`Why`.

- **The lesson is chosen in the dialog, once, for the whole file.** A lesson
  *column* would be a column the importer had to guess at, because a lesson title
  is not unique and two lessons in one course can share a name. A file covering
  two lessons is imported twice.
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
  kind of file, one that will not parse, more than `MAX_IMPORT_ROWS` (300) or
  `MAX_IMPORT_BYTES` (4 MB) — fails the whole request.
- **Everything imported lands needing verification**, like everything generated.

The template is generated rather than shipped as a file, because the headings are
the parser's contract and a template that drifted from the parser would be a
template whose imports fail. A bank's page can also export its questions as CSV
or JSON, which is how the format gets used by the people who have to live with it.

## What a quiz asks

| Route | What it does |
| --- | --- |
| `GET /contents/{contentId}/questions` | what the quiz asks, in order, each with its bank and lesson |
| `POST /contents/{contentId}/questions` | add questions by id — they stay in their banks |
| `DELETE /contents/{contentId}/questions/{questionId}` | stop asking it; the question is untouched |
| `PUT /contents/{contentId}/questions/placement` | move it in the quiz's order |
| `POST /contents/{contentId}/questions/verification` | accept a batch of this quiz's questions |

A course's own page has a **Question banks** tab — between Content and Members —
which is the third way into the same questions: every question about *this
course's* lessons, from every bank, grouped by lesson in the course's own order.
Every lesson appears, including the ones nothing has been written about yet,
because a list of only the finished lessons is a list that cannot tell you what
is left; a lesson with no questions offers to have some generated. It reads
through `SpacePositionIndex`, so the whole tab is one query, and it authorizes as
**organization** membership — a learner registered for the course is not told
what the answers are.

**A quiz can only ask questions about its own course's lessons.** It is enforced
in `addQuestionsToQuiz`, not merely in the picker: a question about a lesson in
another course would be a question its learners cannot answer, because that
lesson is not in the course they registered for. Adding one twice is not an error
— the link table is keyed by (quiz, question), so asking twice is one row, and
the answer reports what was already there.

**Order is the quiz's, not the bank's.** A bank is a library rather than a
sequence: a row's `position` in a bank is the order it was written in, and what a
learner meets is decided by the quiz, which renumbers its own links on a drag.
The drop sends a *place* (`{ questionId, index }`) rather than an order, so a
client that drew a stale list cannot lose a question somebody else added while it
was dragging.

## Ordering and the outline

Moving a lesson or a quiz within or between sections is its own route —
`PUT /contents/{contentId}/placement` — with a place rather than an order, for
the same reason. Both drag surfaces share `lib/placement.ts`.

## Routes, in full

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/organizations/{orgId}/question-banks` | the organization's banks |
| POST | `/organizations/{orgId}/question-banks` | make a bank |
| GET | `/banks/{bankId}` | one bank, with its last run |
| PATCH | `/banks/{bankId}` | rename it, or rewrite what it says |
| DELETE | `/banks/{bankId}` | delete it **and its questions**, out of every quiz |
| GET | `/banks/{bankId}/questions` | its questions, with the bank and the unverified count |
| POST | `/banks/{bankId}/questions` | write one |
| POST | `/banks/{bankId}/questions/import` | import a file |
| POST | `/banks/{bankId}/questions/generation` | queue an AI run (`202`) |
| DELETE | `/banks/{bankId}/questions/generation` | forget the last run |
| POST | `/banks/{bankId}/questions/verification` | accept a batch |
| PATCH | `/questions/{questionId}` | edit it (takes its verification away) |
| DELETE | `/questions/{questionId}` | delete it from its bank and every quiz |
| PUT | `/questions/{questionId}/verification` | verify it |
| DELETE | `/questions/{questionId}/verification` | take that back |
| GET | `/spaces/{spaceId}/questions` | every question about a course's lessons, from every bank |
| GET | `/contents/{contentId}/questions` | what a quiz asks |
| POST | `/contents/{contentId}/questions` | add questions to a quiz |
| DELETE | `/contents/{contentId}/questions/{questionId}` | remove one from a quiz |
| PUT | `/contents/{contentId}/questions/placement` | its place in the quiz |
| POST | `/contents/{contentId}/questions/verification` | accept a batch of a quiz's questions |
| PUT | `/contents/{contentId}/placement` | move a lesson or quiz within / between sections |
| — | (event) | `play.questions` / `Quiz Generation Requested` → `generate-questions` |

**Authorization.** A bank is organization material, like the video library: any
active member may read it — checking a colleague's questions is reading — and
only an admin or an editor may change it. A *quiz's* questions are different:
`requireQuizAccess` asks for a **write** on the organization even to read them,
because they carry the answer key, and a course member who is not in the
organization can read the lesson a quiz sits in without being able to fetch its
answers. The day a quiz can be *taken* is the day a separate route hands out its
questions without the answers — a decision these routes deliberately do not
pre-empt.

## Deleting: what takes what

| Deleting | What goes with it |
| --- | --- |
| A **question** | its links — it disappears from every quiz asking it; the answer says how many |
| A **bank** | its questions, and their links, and so those questions out of every quiz |
| A **quiz** (content) | its links only. The questions stay in their banks, because they were written there and other quizzes may be asking them |
| A **lesson** (content) | every question about it, from every bank, and their links. A question whose lesson is gone points at nothing |
| A **course** (space) | sections → lessons → their questions, by the same cascade |

The order is always children first and the row last, so a failure part way
through leaves something visible and deletable rather than unreachable rows.

## The three tables, and the one thing to do by hand

| Table | Keys | Holds |
| --- | --- | --- |
| `QuestionsTable` | `questionId` | the questions; `BankPositionIndex` (bankId + position), `LessonIndex` (lessonContentId), `SpacePositionIndex` (lessonSpaceId + position) |
| `QuestionBanksTable` | `bankId` | the banks; `OrganizationCreatedIndex` (organizationId + createdAt) |
| `QuizQuestionsTable` | `contentId` + `questionId` | what each quiz asks, and in what order; `QuestionIndex` (questionId) |

None of them is created by a deploy: the data stack **imports** tables
(`ownership.tables` is false, and turning it on would try to create all
twenty-five under new names), so the ones added since the migration are created
by a script, once per stage, before the first deploy:

```bash
node infra/scripts/create-quiz-tables.mjs --plan      # what it would create
node infra/scripts/create-quiz-tables.mjs --yes       # create what is missing
node infra/scripts/create-quiz-tables.mjs --recreate --yes   # rebuild a table whose shape changed, when it is empty
```

It reads the key schemas out of `infra/src/generated/service.ts` rather than
carrying its own copy — one description of each table, and the one the stacks
deploy against — turns on point-in-time recovery, and records the physical names
in `infra/config/play-<stage>.json`. It refuses to rebuild a table with rows in
it: a table with data is a table to copy into a new one, by hand, on purpose.
`--recreate` exists because the model was reshaped once while nothing was in it.

## What is not built

- **Nobody takes a quiz yet.** No attempts, no answers recorded, no marking, no
  score. The marketplace says so on the page rather than pretending: a quiz opens
  as "This quiz cannot be taken yet".
- **No "select all that apply".** A question has exactly one right answer.
  `correctOptionIds` is an array because that is the shape a second kind would
  need, so adding one is a change to validation rather than to storage.
- **No course-wide review queue.** Questions are reviewed on the bank's page and
  on the quiz's: the model is organization-wide, and "everything nobody has read
  in this course" is a read none of the three tables can serve without a fourth
  index. If that screen is wanted, it is an index on `organizationId` + `status`
  and a route, not a rewrite.
- **No tags or difficulty.** A question is about a lesson, and that is the only
  handle on it. Tags would be a filter on top of a filter, and nothing yet asks.

## Where the code is

| What | Where |
| --- | --- |
| The question row, its validator, its statuses | `services/api/src/lib/questions.ts` |
| Banks: their rows, their counters, their list | `services/api/src/lib/question-banks.ts` |
| The links: what a quiz asks, and in what order | `services/api/src/lib/quiz-questions.ts` |
| The prompt, the Bedrock call, the queue, the worker | `services/api/src/lib/quiz-generation.ts` |
| Reading a sheet, a CSV or a JSON file into questions | `services/api/src/lib/question-import.ts` |
| The order arithmetic both drags share | `services/api/src/lib/placement.ts` |
| The routes | `services/api/src/functions/banks/*`, `questions/*`, `quiz/*` |
| A course's tab | `apps/studio/src/components/banks/space-question-banks.tsx` |
| Creating the tables | `infra/scripts/create-quiz-tables.mjs` |
| The editor, the pickers, the dialogs, the quiz panel | `packages/learning/src/components/quiz/*` |
| The Question banks section | `apps/studio/src/app/o/[orgId]/question-banks/*` |
| The client and its caches | `packages/api/src/modules/question/question.queries.ts` |
