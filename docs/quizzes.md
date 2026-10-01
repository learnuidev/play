# Quizzes and question banks

A course can check what it taught. Three records make that work, and the splits
between them are the design:

```
QuestionBank ─── Question ─── Lesson (a VIDEO content)
                    │
                    └── QuizQuestionLink ─── Quiz (a QUIZ content)
                                             │
                                             └── QuizAttempt (somebody sat it)
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
- An **attempt** belongs to a **quiz** — everything ever asked of the attempts
  table is about one quiz — and it *copies* what it asked. It is the one place in
  this model that reproduces a question's words, and it does so on purpose: it is
  a record of what somebody was asked and answered, and a reference would let the
  author's next edit change what a past sitting meant.

That is what makes the model worth its tables: **the bank is a library, the quiz
is a selection, the attempt is what somebody did with it, and the lesson is the
thread that ties a question to something that can change under it.**

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
`answer_a`), `Answer`/`Correct`/`Correct Answer`, `Explanation`/`Rationale`/`Why`,
`Difficulty`/`Level`/`Tier`.

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

## Difficulty: a target, not a measurement

```ts
type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';
```

A question may carry a level, and a level is a **band of expected correct rate**
rather than a score of anything:

| Level | Correct rate it is written to | What writing to it means |
| --- | --- | --- |
| Easy | 76–100% | Literal recall, recognition or naming. Maximum context, and the question points at the answer. |
| Medium | 40–75% | Processing or synthesis, or a two-step answer. Some context removed, so the options have to be narrowed down. |
| Hard | 11–39% | Exact timelines, nuanced wording or a specialised corner. Plausible distractors that have to be judged rather than spotted. |
| Expert | 10% or fewer | An elite or competition standard. Context heavily removed — answerable only with years in the subject. |

The four are named rather than numbered because an author who is told "easy" and
nothing else has been told nothing they can hold a question against. Each level is
two facts in one: a band, which is what a set is aiming at, and a way of writing,
which is what the prompt of a generation run is actually given. Both live in
`QUESTION_DIFFICULTY_TARGETS` and `QUESTION_DIFFICULTY_DESCRIPTIONS`, and the
picker that an author chooses from states them under the four buttons.

Five things about it are decisions rather than consequences.

- **It is optional, and a level is not a status.** A question with none is
  *ungraded* — not a draft, not unusable, and not hidden from a quiz. Nothing
  reads a level, so an absent one breaks no screen; every question written before
  this existed has none, and there is no backfill, because there is nothing to
  backfill it *from*. The difference from a question's lesson, which is required,
  is what the field is for: a question without a lesson cannot be checked, and a
  question without a level is one nobody graded.
- **`EASY` is the default, and not the middle.** `DEFAULT_QUESTION_DIFFICULTY` is
  what a form starts a new question at and what a run writes at when it is not
  told. The asymmetry is the point: a question that turns out too easy is one an
  author promotes a level, and one that turns out too hard is one their learners
  cannot answer at all. The default is the mistake that costs a click.
- **It is set at all three doors in.** The form (`QuestionDialog`), a generation
  run, and a file — the last through a `Difficulty` column, read leniently
  (`moderate`, `Difficult`, `very hard` all work, in `readQuestionDifficulty`) and
  **refused** when it says something no level does, because an invented level is
  a question quietly mislabelled and a row that says which words are allowed is
  not. A run takes **one level for the whole set**: the level is the instruction
  to the model rather than a label applied afterwards, so an author wanting a
  spread asks twice. Every question a run writes is stamped with what was asked
  for and nothing the model returns can change it — a model grading its own
  homework is not a difficulty. See `resolveQuestionDifficulty` and
  `buildPrompt`.
- **Grading a question does not take its verification away.** This is the one
  place difficulty meets the status model, and it goes the other way: the prompt,
  the options, the answer and the lesson are what somebody read and agreed to,
  while a level says how hard the question is and not what it asks. It is
  therefore *not* part of `UpdateQuestionPatch.invalidateVerification` — a rule
  the edit route states where it reads the body, beside the note that an
  explanation is in the same position.
- **A learner is never shown it.** The paper is a `prompt` and its `options` and
  nothing else, and the level has no field there to travel in. A quiz that told
  a learner which questions were the hard ones has told them something about the
  answers, and telling them *after* they have answered is a different feature
  with a different argument to make.

**No route changed for this.** The level rides in bodies that already exist —
`POST /banks/{bankId}/questions`, `PATCH /questions/{questionId}`, the import and
`POST …/questions/generation` — and it is a plain attribute on the row, so
`QuestionsTable` keeps the three indexes it has. Nothing indexes it and no route
filters on it: a bank is read whole and a course's questions are read whole, and
"everything of mine that is hard" is a question nothing asks yet. When something
does, that is an index and a parameter rather than a reshape.

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
**This is the door to them, and the community's own bar no longer has one.** The
organization-wide page (`/o/{orgId}/question-banks`) is still there and still
works — the tab's "All banks" button goes to it — but a top-bar tab named after
it was a list of everything a community had ever written with no course attached
to any of it: the questions are about *lessons*, so the page that knows what to
do with them is the course they belong to.
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
| GET | `/contents/{contentId}/quiz` | the quiz as a learner is handed it: the questions without the answers, and the caller's own sittings |
| POST | `/contents/{contentId}/quiz/attempts` | hand in a sheet and be marked (`201`) |
| PUT | `/contents/{contentId}/placement` | move a lesson or quiz within / between sections |
| — | (event) | `play.questions` / `Quiz Generation Requested` → `generate-questions` |

**Authorization.** A bank is organization material, like the video library: any
active member may read it — checking a colleague's questions is reading — and
only an admin or an editor may change it. A *quiz's* questions are different:
`requireQuizAccess` asks for a **write** on the organization even to read them,
because they carry the answer key, and a course member who is not in the
organization can read the lesson a quiz sits in without being able to fetch its
answers. Taking a quiz is the other side of that, and it is built as the separate
route those authoring routes deliberately did not pre-empt: `GET
/contents/{contentId}/quiz` is authorized as a **read** of the course — so the
learner registered for it, who is in no organization at all, may open it — and it
answers with a shape that has nowhere to put the key. See below.

## Taking a quiz

A learner is handed a **paper** and hands back a **sheet**, and the API does the
rest. Two routes, and everything about them follows from one rule: *the answer
key never reaches a learner who has not answered.*

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/contents/{contentId}/quiz` | The questions without the answers, plus the caller's own sittings |
| POST | `/contents/{contentId}/quiz/check` | Whether one answer is right — **records nothing** |
| POST | `/contents/{contentId}/quiz/attempts` | Hands in a sheet, gets the marked attempt back |

- **The paper is a shape, not a filtered row.** `QuizPaperQuestion` is a question
  with no `correctOptionIds` and no `explanation`, and `toPaperQuestion` is the
  only thing that builds one — a handler that forgot to strip the key would have
  to add a field to a type to leak it. The authoring routes are untouched and
  still refuse a learner outright.
- **Only verified questions are asked.** The paper holds back everything still
  `NEEDS_VERIFICATION` and counts it (`heldBack`), so the page can say *why* a
  quiz looks short instead of looking broken. This is what the status was for: a
  model's first guess must never mark a person, and "ask it anyway and correct it
  later" is exactly the failure the whole verification model exists to prevent.
- **Marking happens on the server, in the request that records the attempt.**
  The sheet is `{ answers: [{ questionId, optionId }] }`; a question left out is
  one the learner skipped, which is wrong rather than absent — the score is over
  the questions the quiz asks. An answer to a question the quiz no longer asks
  (an author edited while somebody was sitting it) is dropped rather than
  refused, and a page can tell, because the attempt comes back saying which
  questions it was marked on.
- **The attempt is a record of a moment, and reads on its own.** Each answer
  carries the prompt, the options, what the learner chose, what was right *then*
  and the explanation — so a question edited or deleted afterwards neither
  re-marks the attempt nor leaves a blank where it was. It is the one place in
  this model that copies question text, and deliberately: a reference would make
  a term of attempts change meaning under the author's next edit.
- **One answer can be checked on its own, and checking records nothing.** `POST
  /contents/{contentId}/quiz/check` says whether the answer in hand is right,
  which option was, and why — the moment a quiz teaches anything, and the reason
  it is sat one question at a time. It writes no row: an attempt is one sitting,
  recorded when a sheet is handed in, and a row per look would turn "how did I
  do" into a log of keystrokes. So checking is free — a learner can check, be
  wrong, think, and check the other option with no wrong answer kept anywhere.
  Marking on the client was the alternative and is not one: it would mean sending
  the key to the page.
- **The options are dealt afresh on every sitting.** An author writes the right
  option where it reads best — often first, and often first in every question —
  and a quiz taken in that order can be passed by pattern rather than by knowing
  anything. So the page deals each question's options itself, with a shuffle that
  is *per sitting*: an order the API picked would be the same order on every
  retake, which is a shuffle somebody can learn, and the point is that the answer
  is not where it was last time. "Try again" deals a new hand.
- **What was shown is sent back with the sheet.** The page is the only party that
  saw the deal, so `POST …/quiz/attempts` takes an `order` — question id to the
  option ids in display order — and records the attempt in it, which is what keeps
  an attempt a record of the sitting that happened rather than of the author's
  file. The API checks it is a permutation of that question's own options before
  using it (`orderedOptions`) and falls back to the author's order if it is not:
  a body that can only rearrange options is worth accepting, and the marking goes
  by option id either way. A refetch is what would deal the options again under
  somebody's hands, so the paper is not refetched in the background while it is
  open.
- **Handing in finishes the quiz.** Submitting writes the completion and checks
  the course's rewards in the same request, exactly as marking a lesson complete
  does, so the outline ticks the quiz and the course page's percentage moves. A
  score is not a threshold — a quiz is *taken*, not passed, and an attempt that
  scored nothing still finished it.
- **Retakes are free and unlimited.** Every sitting is a row, the page opens on
  the newest result, and the header says how many times it has been sat and the
  best score. There is no attempt in progress: a row is written when a sheet is
  handed in and never edited, so a learner who opens a quiz and closes it has
  attempted nothing.

The two halves of the marketplace's screen are one component, `QuizPanel`, and
`canEdit` is which one is drawn: an author gets the questions with the key and
everything that edits them, a learner gets `QuizTaking`. Nothing in the learner's
component could mark a question, because the answers are not in the document it
holds.

**A learner sits a quiz one question at a time, in the lesson's own frame.**
`LessonReaderFrame` is the bar, the card, the dock and the rail that a lesson is
drawn in (see [workspace.md](workspace.md)), and a quiz puts one question in its
card with `Back` and `Next` under it — a quiz in `skld-app` is a block on that
same card, so a learner moving from a lesson to the quiz beside it is moving to
the next thing in the course rather than to a different product. The bar counts
answers while it is being sat and correct answers once it has been handed in, the
question's own frame answers — green or red, where a lesson's stays grey because
a video has nothing to be right about — and the rail holds the
course's contents and the quiz's discussion.

## Deleting: what takes what

| Deleting | What goes with it |
| --- | --- |
| A **question** | its links — it disappears from every quiz asking it; the answer says how many. Attempts made against it are untouched: a record of what somebody was asked is not a copy of the question |
| A **bank** | its questions, and their links, and so those questions out of every quiz |
| A **quiz** (content) | its links, and **every attempt at it**. The questions stay in their banks, because they were written there and other quizzes may be asking them |
| A **lesson** (content) | every question about it, from every bank, and their links. A question whose lesson is gone points at nothing |
| A **course** (space) | sections → lessons → their questions, by the same cascade, and each quiz's attempts with the quiz |

The order is always children first and the row last, so a failure part way
through leaves something visible and deletable rather than unreachable rows.

An attempt is swept up where a favourite is not, and the difference is what the
row is *for*: a favourite is a learner's own pointer, skipped when its target has
gone, while an attempt is a record of answering one particular quiz — with the
quiz gone there is nothing it is an attempt at, and nothing reads an attempt
except through the quiz it was made in. It is also one query: the attempts table
is partitioned by the quiz, so deleting one reads the partition and empties it.

## The four tables, and the one thing to do by hand

| Table | Keys | Holds |
| --- | --- | --- |
| `QuestionsTable` | `questionId` | the questions; `BankPositionIndex` (bankId + position), `LessonIndex` (lessonContentId), `SpacePositionIndex` (lessonSpaceId + position) |
| `QuestionBanksTable` | `bankId` | the banks; `OrganizationCreatedIndex` (organizationId + createdAt) |
| `QuizQuestionsTable` | `contentId` + `questionId` | what each quiz asks, and in what order; `QuestionIndex` (questionId) |
| `QuizAttemptsTable` | `contentId` + `attemptKey` (`userId#attemptId`) | the sittings of each quiz, and every answer in them. No index |

**Nothing is indexed on `QuizAttemptsTable`, and that is the key choice.** Both
questions it is ever asked are about one quiz — "what have I scored on this" is a
learner's prefix of the partition, and "what becomes of these when the quiz goes"
is the partition itself — so the quiz is the partition and the learner is inside
it. Keyed by the learner instead, the first would be a query and the second would
need an index; keyed this way, both are one query and neither needs one. The sort
key being `${userId}#${attemptId}` is what makes that work: an attempt id is a
ULID, so it sorts by the moment it was made and "newest first" costs no attribute.

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

**`QuizAttemptsTable` is the one table this feature still needs created**, and the
name in `infra/config/play-dev.json` is there for a stage where the deploy has
not run the script yet — `synth` reads that file, and a table in the service
table with no name in the config fails the synth rather than deploying a Lambda
pointed at nothing. So the order is: run the script, then deploy.

## What is not built

- **No "select all that apply".** A question has exactly one right answer.
  `correctOptionIds` is an array because that is the shape a second kind would
  need, so adding one is a change to validation rather than to storage.
- **No course-wide review queue.** Questions are reviewed on the bank's page and
  on the quiz's: the model is organization-wide, and "everything nobody has read
  in this course" is a read none of the four tables can serve without an index.
  If that screen is wanted, it is an index on `organizationId` + `status` and a
  route, not a rewrite.
- **Nobody but the learner sees a result.** An attempt is the learner's own
  record, and no route reads anybody else's — an author asking "how did the class
  do" is a screen, a permission and a decision about whether a score is feedback
  or a mark, and none of those exist yet. The table is already partitioned by the
  quiz, so that read is one query when it is wanted; what is missing is the
  answer to who is allowed to ask it.
- **No time limit, no pass mark, no attempt ceiling.** A sitting is untimed, a
  score is not a gate, and retakes are unlimited. Each of those is a rule that
  would have to live somewhere a learner can read it before they start, so none
  of them is guessed at now.
- **No tags.** The two handles on a question are its lesson and its difficulty,
  and neither is a tag: the lesson is what the question can be checked against
  and the level is a rule about how it is written. A tag would be a filter on top
  of a filter that nothing yet asks for.

## Where the code is

| What | Where |
| --- | --- |
| The question row, its validator, its statuses | `services/api/src/lib/questions.ts` |
| Banks: their rows, their counters, their list | `services/api/src/lib/question-banks.ts` |
| The links: what a quiz asks, and in what order | `services/api/src/lib/quiz-questions.ts` |
| The attempts: their keys, their marking, the paper and its stripping | `services/api/src/lib/quiz-attempts.ts` |
| The prompt, the Bedrock call, the queue, the worker | `services/api/src/lib/quiz-generation.ts` |
| Reading a sheet, a CSV or a JSON file into questions | `services/api/src/lib/question-import.ts` |
| The order arithmetic both drags share | `services/api/src/lib/placement.ts` |
| The routes | `services/api/src/functions/banks/*`, `questions/*`, `quiz/*` |
| A course's tab | `apps/studio/src/components/banks/space-question-banks.tsx` |
| Creating the tables | `infra/scripts/create-quiz-tables.mjs` |
| The editor, the pickers, the dialogs, the quiz panel, the paper | `packages/learning/src/components/quiz/*` |
| The Question banks section | `apps/studio/src/app/o/[orgId]/question-banks/*` |
| The client and its caches | `packages/api/src/modules/question/question.queries.ts` |
