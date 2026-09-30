# Play — Full-stack AWS video streaming service

A full-stack video streaming service on AWS, implemented from the architecture
described in `streaming_tutorial_source.vtt` (private S3 bucket + CloudFront CDN
in front of it) and extended into a production-style service with authentication,
encoding, adaptive-bitrate playback, and a REST API.

It is one repository with two apps on top of one backend. **Play Studio** is
where a creator makes a course — uploading videos, arranging sections and
lessons, inviting the people taking it. **Play Marketplace** is where a learner
finds a published course, registers for it, and takes its lessons. Both render
the same classroom, from the same shared packages, against the same API and the
same Cognito user pool: an author and a learner are the same person with
different intentions.

## Architecture

```
┌────────────────────┐
│  apps/studio       │──┐
│  apps/marketplace  │──┼─ REST (HTTPS + JWT) ─▶ ┌──────────────────────────────┐
│  (Next.js, shared  │  │                        │ API Gateway (REST)           │
│   @play/* packages)│  │                        │  ├─ Cognito User Pool auth   │
└─────────┬──────────┘  │                        │  └─ Lambda (Node.js/TS)      │
          │ 1. presigned PUT                      └──────┬───────────────┬───────┘
          │ 2. GET /videos, /videos/{id}/stream           │               │
          ▼                                               ▼               ▼
┌────────────────┐   uploads/  ┌──────────────────────┐   ┌─────────────┐
│  S3 (private)  │ ◀────────── │  S3 event → Lambda    │   │  DynamoDB   │
│  play-videos   │             │  → MediaConvert (HLS) │   │  (metadata) │
└───────┬────────┘             └──────────────────────┘   └─────────────┘
        │ processed/ (HLS)
        ▼
┌─────────────────────┐
│ CloudFront (CDN)    │ ◀── signed URLs (OAC + trusted key group)
└─────────────────────┘
```

### Key AWS services

- **Cognito** — user authentication (email sign-up/sign-in). API Gateway uses a
  `COGNITO_USER_POOLS` authorizer; every endpoint requires a valid ID token.
  Google sign-in is supported through Cognito federation (Hosted UI + OAuth code
  flow) and is optional — see [Google sign-in](#google-sign-in-optional).
- **API Gateway (REST)** — fully RESTful surface for videos.
- **Lambda + TypeScript** — 134 handlers, bundled with `esbuild` and deployed by
  the AWS CDK app in `infra/`.
- **DynamoDB** — video metadata, keyed by `videoId`, with four GSIs: owner and
  organization indexes for listing/filtering, so a user's uploads and an
  organization's library are both a `Query`. Organizations and their memberships
  live in two further tables, and the courses an organization publishes
  (**spaces**) in a third — see
  [Videos belong to organizations](#videos-belong-to-organizations),
  [Organization lifecycle](#organization-lifecycle), and
  [Spaces (courses)](#spaces-courses). What a space holds — its **sections**,
  the **content** filed under them, and the **files** attached to that content —
  is three more tables, and learner state (**favourites**, a **learning
  playlist**, and **comments**) three more again: see
  [Sections and content](#sections-and-content) and
  [Learner state](#learner-state).
- **S3** — private bucket (block all public access, ACLs disabled, SSE-S3).
  Raw uploads under `uploads/{videoId}/`, transcoded HLS under
  `processed/{videoId}/hls/`, poster frames and space covers under
  `thumbnails/{videoId}/` and `spaces/{spaceId}/`, and lesson material under
  `contents/{contentId}/`.
- **MediaConvert** — transcodes uploads into an HLS adaptive-bitrate ladder
  (1080p/720p/480p/360p/240p/144p). Completion is detected via CloudWatch
  Events.
- **Transcribe** — generates WebVTT subtitles from the raw upload (in parallel
  with encoding), and the word-level timings the animated transcript animates
  against. Completion is detected via CloudWatch Events.
- **CloudFront** — CDN in front of S3 using **Origin Access Control** (S3 is
  only reachable through CloudFront). Videos are protected with **signed URLs**
  backed by a trusted key group.

## Repository layout

One npm workspace, four kinds of package:

```
play/
├── apps/
│   ├── studio/           Play Studio — the creator's app (Next.js, port 3000)
│   ├── marketplace/      Play Marketplace — the learner's app (Next.js, port 3001)
│   └── demo/             Play Demo — a third-party app on the same API (port 4000)
├── packages/             shared source, consumed by both apps
│   ├── types/            the shapes the API and both apps agree on
│   ├── api/              the API client and every React Query hook on it
│   ├── auth/             Cognito wiring, the provider stack, the sign-in gate
│   ├── ui/               design primitives: button, card, dialog, tabs, …
│   └── learning/         the classroom, the player, the outline, course cards
├── services/
│   └── api/              the backend's handlers (TypeScript, Node.js 22, no infrastructure)
├── infra/                the AWS CDK app that deploys them — see infra/README.md
└── scripts/              get-env.mjs, used by both apps
```

Both apps depend on `@play/*` packages by name, and the packages ship **source**
(`src/*.ts`, no build step): Next compiles them as part of the app through
`transpilePackages`, so a change to a shared component is a change both apps
typecheck. Each package declares its own dependencies, and its own tsconfig gives
it `@ui/*`, `@api/*`, `@auth/*` and `@learning/*` aliases so no file inside a
package needs a chain of `../../`.

Where two apps need the same _screen_ rather than the same component, the screen
asks the app for what differs. The classroom is the example: it takes the course
and lesson it is showing, and a `LearningRoutes` object saying where a course and
a lesson live — `/o/{orgId}/spaces/{spaceId}/contents/{contentId}` in the studio,
`/courses/{spaceId}/lessons/{contentId}` in the marketplace. See
[docs/workspace.md](docs/workspace.md) for the full layout and the conventions
that keep it that way.

## The studio's layout

The app is a **community shell**, modelled on the three-column community layout:

```
┌────┬──────────────────────┬──────────────────────────────────────┐
│    │ Vishal's Circle ▾    │  Home  Videos  Spaces  Members    ◐ ● │
│ ●  ├──────────────────────┼──────────────────────────────────────┤
│ ●  │ Home                 │ ┌──────────────────────────────────┐ │
│ ●  │ Videos               │ │ Spaces                           │ │
│ ○  │ Spaces               │ │                                  │ │
│    │ Members              │ │   [space cards, or empty state]  │ │
│ +  │ Organization settings│ │                                  │ │
│    │                      │ └──────────────────────────────────┘ │
│    │ Your spaces          │                                      │
│    │  ● Film Studies      │                                      │
│    │  ● Photography       │                                      │
│    │  + New space         │                                      │
└────┴──────────────────────┴──────────────────────────────────────┘
 rail    community nav          tabbed main area
```

- **The rail** (`components/shell/org-rail.tsx`) is the community switcher: one
  avatar per organization you belong to, with `+` to create another. The tiles
  are monochrome on purpose — `--primary` follows the theme — so no organization
  out-shouts another; the colour a _space_ is drawn in is the space's own.
- **The community nav** (`components/shell/community-sidebar.tsx`) shows which
  organization you are in, the organization's five sections — Home, Videos,
  Spaces, Members and Organization settings, the four the tab bar carries plus
  the one it leaves out — and then the spaces themselves (each with its accent
  dot, capped at eight with an "All N spaces" link beyond that, and a "New space"
  link for admins and editors), under a heading of their own so the section link
  and the list are not read as the same thing.
- **The main area** (`components/shell/org-tabs.tsx`, `page-card.tsx`) is a tab
  bar over a card per page — except on a course's own page and in a lesson, where
  the page speaks for itself and the bar stays out of it.
- **The Members tab** (`app/o/[orgId]/members/page.tsx`) is the roster over the
  role reference. Inviting is a modal over the page
  (`components/organization/invite-member-dialog.tsx`) rather than a route:
  adding somebody is part of reading the list they are joining. An invitation
  addressed to the signed-in user leads the page with the one button that does
  anything about it, and the offers themselves are listed on `/organizations`,
  because somebody who belongs nowhere yet has no organization page to be on
  ([Members](#members)).

Two routes are not this shape. A lesson drops the rail, the community nav and
the tab bar and fills the window with the video and the lesson's own panel —
[The classroom](#the-classroom), below. A course's own page keeps the rail and
the community nav but drops the tab bar, because it has a header and a tab strip
of its own: the bar above them would be a second answer to "where am I", and on a
course that keeps its own members it would be the same word twice on one screen.
Both decisions are the shell's, taken from `lib/routes.ts`'s `lessonRoute` and
`spaceRoute`, so the bar and the page cannot disagree about which routes they are.

A space's own page is the one place that is not a card per concern: it is the
course outline, a block per section with the lessons filed under it, and the
controls to rearrange them (`components/content/content-outline.tsx`). Creating a
section or a lesson happens in a modal over that page rather than on a route of
its own, because neither is a destination — a course is arranged in one place.
The notes editor is loaded on demand (`notes-editor.tsx`), so TipTap and
ProseMirror arrive in a chunk of their own the first time notes are written and
never with the outline.

## The classroom

A lesson is where the shell gets out of the way. It is the one route that is
_read_ rather than browsed, so it takes the whole window — and it is drawn two
ways, which is what `layout` chooses. **An author gets `panel`**, the studio's
arrangement: the video beside a panel of tabs, both columns scrolling, everything
the lesson holds on screen at once because the person looking at it is working on
it. **A learner gets `reader`**, the marketplace's: one screen that does not
scroll, arranged the way `skld-app` arranges its lesson player.

```
reader — apps/marketplace
         /courses/{spaceId}/lessons/{contentId}          (a lesson)
         the same URL, for a quiz

┌───────────────────────────────────────────────────────────────────┐
│ ✕   ‹─── progress, one arrow each side ───›   ●●○●●  12   ☾       │
├──────────────────────────────────────────────┬───┬──────────────┤
│ ┌ card ────────────────────────────────────┐ │ ☰ │ ┌ rail ─────┐ │
│ │            Why rhythm matters            │ │ 📝 │ │ Contents  │ │
│ │        ┌────────────────────────┐        │ │ 📄 │ │ ────────  │ │
│ │        │     video, playing     │        │ │ 🔁 │ │ 01 START  │ │
│ │        └────────────────────────┘        │ │ 💬 │ │  ● Why…   │ │
│ ├──────────────────────────────────────────┤ │   │ │ 02 LIGHT  │ │
│ │            [ ✓ Complete lesson ]         │ │   │ └───────────┘ │
│ └──────────────────────────────────────────┘ │   │               │
└──────────────────────────────────────────────┴───┴──────────────┘
   the lesson's own face                        dock  the material

a quiz is the same frame, one question in the card:

┌───────────────────────────────────────────────────────────────────┐
│ ✕   ‹────── 3 of 8 answered ──────›                          5  ☾ │
├──────────────────────────────────────────────┬───┬──────────────┤
│ ┌ card ────────────────────────────────────┐ │ ☰ │ ┌ rail ─────┐ │
│ │           Question 3 of 8                │ │ 💬 │ │ Contents  │ │
│ │      What year did the cut land?         │ │   │ │ ────────  │ │
│ │      ◉  1994      ○  1996                │ │   │ │ 01 START  │ │
│ ├──────────────────────────────────────────┤ │   │ │ 02 LIGHT  │ │
│ │         [ Back ]      [ Next › ]         │ │   │ └───────────┘ │
│ └──────────────────────────────────────────┘ │   │               │
└──────────────────────────────────────────────┴───┴──────────────┘
```

`LessonReaderFrame` is that arrangement, and **both kinds of content draw
themselves in it**: a lesson puts its video in the card, a quiz puts one question
there, and neither has to know how a bar, a card, a dock or a rail is put
together. Everything about the reader arrangement follows from four decisions:

- **The bar is progress through a sequence.** For a lesson that sequence is the
  course, because a lesson is one video and a bar for it would fill once; the dots
  beside it are the lessons one at a time and the arrows step between them. For a
  quiz it is the questions: answered while it is being sat, right once it has been
  handed in.
- **One thing at a time in the card, and the card is framed rather than
  coloured.** skld puts a block's heading and its task in a card whose border
  says whether the answer was right; this puts a lesson's title and video there,
  and, for a quiz, one question. The frame is grey and stays grey around a video,
  which has nothing to be right or wrong about — whether a lesson is finished is
  said by the pill under it, once. A marked *question* is the one thing here with
  an answer, so it tints its own frame, which is the whole reason the frame has
  states at all. The footer under the card is skld's: the screen's one decision
  stretching across what is left, with quieter pills beside it.
- **The dock is everything the content holds, stacked as icons against the right
  edge.** skld does not have one, because its rail holds one thing and opens from
  a pill on the card; a lesson here holds five or six, and a row of pills that
  grew with the material was a row of pills. The dock never moves — the rail opens
  to its left, so a column of controls that slid sideways every time a panel
  opened is exactly what it is not. A quiz draws the same dock with what a quiz
  has: the course's contents, and its discussion.
- **The rail is the material, off the screen.** A column at the right-hand edge on
  a wide screen and a panel under the dock on a narrow one, with the dock's own
  icon putting it away again. A lesson's discussion is a tab here rather than a
  section under the video: there is no column to put it under when the screen *is*
  the picture.
- **Waiting and failing happen inside the frame.** The bar, the card and the dock
  are drawn at their real size from the first paint, and only the card's contents
  change — a skeleton, a refusal, an empty state, a question. A shell that arrived
  after the content did would move everything on the screen the moment it loaded.

```
panel — apps/studio, /o/{orgId}/spaces/{spaceId}/contents/{contentId}

┌───────────────────────────────────────────────────────────────────┐
│ ‹ Why rhythm matters                            ✓ Complete lesson │
├───────────────────────────────────┬───────────────────────────────┤
│ ┌───────────────────────────────┐ │ Course Transcript Notes …     │
│ │      video, playing           │ │ ──────────────────────────────│
│ │      where it is talked       │ │ 01 GET STARTED                │
│ │      about                    │ │  │ ● Why a cut lands          │
│ └───────────────────────────────┘ │  │   Cutting on motion        │
│ Comments                          │ 02 LIGHT AND SHADOW           │
│ ┌───────────────────────────────┐ │  │   Reading a histogram      │
│ │ Add a comment…                │ │                               │
│ └───────────────────────────────┘ │                               │
└───────────────────────────────────┴───────────────────────────────┘
         60%                                    40%
         the video, and                        everything filed
         the discussion                        under it, and the
         under it                              course it is in
```

Everything below is the panel arrangement's, and most of it is shared: the two
columns are two different frames around the same player, transcript, notes, files,
loops, discussion and completion.

- **No tab bar, no organization rail, no column beside it.** A row offering
  Home, Videos, Spaces and Members above a video is chrome nobody asked for, and
  the rail is a community switcher, not course navigation. The course itself used
  to be the shell's middle column; a column of navigation costs the video its
  width for as long as the page is open, so the course is a tab of the lesson's
  own panel now — and the way back to the space is the link at the top of the
  page and the header of that tab.
- **The Course tab is the course** (`components/content/course-contents.tsx`):
  sections in order, the lessons in each, the one being read marked. It leads the
  strip because it is the one tab that answers "where is this?" rather than "what
  is in it", and it is reached for less often than the rest — which is exactly
  why it is not a column of its own any more. The panel still opens on the
  transcript, which is what is watched _with_.
- **One breadcrumb line, not a heading.** The lesson's name sits at the top left
  in the same voice as the way back on a course's own page — 13px, muted, with
  the chevron — and is itself the way back to the course, so the section the
  lesson sits in is not named twice. What the page does _not_ have is a 24px
  title over the picture: the video is the subject, and a heading that size above
  it made the lesson the subject instead. Beside the name is what the lesson
  carries — its files — and, for an author, the `⋯` actions; the far corner holds
  the two things a reader can do with it, the heart that keeps it for later and
  the "Complete lesson" pill. Below `md` the row wraps — breadcrumb, counts and
  actions, then the heart and the pill together — because a name squeezed between
  two controls is not a name. The tab strip and the picture then start on the
  same line, which is what the title being under the picture made impossible.
- **The heart is the favourite** (`components/content/content-favourite.tsx`),
  and it carries the count rather than the count sitting beside it: the number
  and the control that moves it are one thing, and a lesson whose favourites are
  counted on the left and hearted on the right says the same fact twice. It is an
  outline pill beside the lesson's one decision rather than a pill of its own
  shape — finishing a lesson is where a reader is going, and keeping it is what
  they do on the way — and the fill and the colour are the whole of what changes,
  which is what lets the count stay where it is instead of the label saying
  "Saved". The answer is the server's: the mutation writes the new state and
  count into the cached lesson from the response, so the heart fills on the press
  rather than a request later.
- **Two columns, six to four.** The video takes 60% of the width and the tab
  panel the rest — watched and read at once, which is the whole point of a
  transcript that follows the playhead. It is a ratio rather than a floor, so
  both tracks grow with the window and the panel stays a readable column of prose
  on anything wide enough to hold two. Below `lg` they stack and the page scrolls
  normally, because a phone has no second half to give. The classroom gets a
  wider canvas than the rest of the app for the same reason: three fifths of a
  reading measure is not a video.
- **The discussion is under the video**
  (`components/content/content-comments.tsx`), not in the panel beside it. A
  comment is about what is playing, so it is read where the playing is; as a tab
  it was a conversation in a narrow column next to the transcript, and on a phone
  behind a press below the video — which is a strange place for the one part of
  the page that everybody else writes.
- **The video plays on the page.** Playback lives here now rather than behind a
  link to the library: a lesson _is_ the video and the material around it, and
  being sent elsewhere to watch it is what made the two feel like separate
  things. Captions are deliberately not switched on — the transcript tab is the
  words, animated and seekable, and a second copy of the same sentence over the
  picture would only be in the way.
- **Both columns scroll, not the page.** The two columns fill the window's height
  and each scrolls inside itself: the tab panel, and the video's own column, which
  carries the discussion and is therefore as long as the class is talkative.
  Nothing moves the window, so reading the transcript never scrolls the picture
  away — the one scroll that does take the video off screen is the one you made to
  reach the comments under it. The transcript owns its own scroll — the sheet
  follows the playhead itself — so the panel must not scroll it a second time.
- **Five tabs.** Course, Transcript, Notes, Files, Loops. Files earned a tab
  rather than being dropped: the content model has attachments, and a tab keeps
  the page one structure instead of a tab bar plus a stray block. The course
  earned one the other way round — it was chrome that had a column of its own, and
  the column was the expensive way to keep it. The sixth, Comments, stopped being
  a tab when the discussion moved under the video.
- **The panel remembers where you were.** Choosing the next lesson out of the
  Course tab used to throw the reader back to the transcript at the top of the
  list, which made the tab useless for working through a course
  (`hooks/use-lesson-tab.ts`, `use-remembered-scroll.ts`). The tab you are on is
  part of where you are, so it outlives the lesson it was chosen on — and so is
  the list's scroll position, since the list is the same list before and after.
  Both live in module state rather than in the URL: a view is not a fact about
  the lesson, and every link into a lesson would otherwise have to carry it,
  including the ones this page builds for the next lesson and the advance card.

### The animated transcript

The transcript is a page of prose whose ink arrives as it is spoken. Lines are
grouped into paragraphs by the pauses between them — a subtitle file breaks text
where it fits on screen, not where a speaker stopped — and every word fills from
left to right as the playhead crosses it, staying dark once it has been said.
Once the playhead has moved on, the lines behind it soften and blur, so exactly
one line is in focus at a time: the one being said.

`lib/transcript.ts` builds it: one token per word, each carrying the stretch of
time it is spoken over.

- **It animates off the media element, not off `timeupdate`.** The element
  reports its position about four times a second — enough to know where playback
  is, far too little to fill a word with: a fill driven by it steps a quarter of
  a second at a time instead of travelling. The player exposes `getTimeMs()`, and
  the transcript's frame loops read it directly, so the front glides through each
  word letter by letter.
- **What has been said goes out of focus** (`.tt-past` in `globals.css`). The
  fill says where the playhead is; blurring the lines behind it says where the
  reader is, and leaves the line being said as the only sharp thing on the page.
  Blur rather than a fade alone, because a faint grey is already what "not yet
  said" looks like here — the words still to come are drawn in the same ink at
  26% — and nothing would be more confusing than unsaid text rendered in the
  told-you-already tone. It is put on the words rather than on the sentence they
  are in: they are the inline-blocks a filter paints predictably, they are only a
  couple of dozen per line on screen, and a seek back over a line clears it to
  sharp again the moment the playhead is on it. A pixel and a half and half
  opacity: enough that the eye drops it, not so much that scrolling up to re-read
  something is a squint.
- **Real word timings where they exist.** AWS Transcribe reports a word-level
  timing for every word beside the WebVTT file it writes, so the video's
  transcript JSON is kept as an artifact of its own
  (`subtitles/{videoId}/words.json`, written by
  `functions/processing/subtitle-generation-complete.ts`) and handed out with
  the subtitles. A cue says "these words are on screen from 12.4s to 15.1s"; it
  cannot say which word arrives when.
- **Interpolated when they do not.** A video transcribed before that existed, or
  a transcript edited after it, still animates: the cue's duration is spread
  across its words in proportion to their length. A line's words are only paired
  with real timings when the two describe each other exactly — a mismatch would
  animate the wrong words, so the cue is spread instead.
- **Nothing goes through React.** A frame loop writes two custom properties onto
  the words of the one line being said — `--p`, how much of the word is filled,
  and `--pop`, the swell of the word being said right now — and the CSS in
  `globals.css` turns them into a gradient clipped to the glyph, a lift and a
  glow. Re-rendering a line sixty times a second to move a fill front would cost
  more than the animation. Writes are quantised and compared against the last
  value, and only the moving word is promoted to its own compositor layer.
- **The sheet glides itself on a spring.** It drives its own `scrollTop` towards
  the line being read rather than animating a scroll: a CSS scroll animation
  restarts on every line change and reads as a series of jumps, while a spring
  carries its velocity across them and settles only on arrival. A seek is not a
  fast glide — past a screen and a half it lands instead of flying through
  everything in between.
- **The line being read is the one that started most recently**, not the one
  whose start and end bracket the playhead. A transcript is full of silences, and
  a bracketing test reports nothing being read for the length of every one of
  them: the sheet stops following and the fill stalls mid-word. Silences are what
  paragraphs are made of, so this matters more here than anywhere.
- **Scrolling it yourself pauses the follow** for a few seconds rather than
  fighting you, and it picks itself up again once you stop — with a "back to the
  current line" button for when you would rather not wait.
- **The sheet ends where the transcript ends.** The reading anchor is a fixed
  height from the top of the panel, and parking a _line_ there needs scrollable
  room beneath it; parking the last line there needs a screenful of room beneath
  it, which is a blank page a reader can scroll into. So the room below is one
  anchor tall, the transcript stops a margin past its last line, and over the
  final screenful the lines settle towards the bottom as they are spoken the way
  any document ends.
- **Tapping a word seeks to that word.** Looking something up is not a seek, and
  neither is reading ahead.

### The discussion

The lesson's discussion (`components/content/content-comments.tsx`) sits under the
video: what everybody watching it said, each with a heart, a reply box, and a
palette of emoji for the sentence itself.

- **Set in `text-lg`, and everything else on the scale below it.** A comment is
  the thing being read, in a column under a video rather than in a sidebar, so it
  is the largest prose on the page — with the name a step down (`text-base`), the
  time, the heart and the reply a step down again (`text-xs`), and the section
  heading a step up (`text-xl`) so it introduces that text rather than captioning
  it. The box a comment is written in is the same size as the comment it becomes,
  which is why its textarea pins `md:text-lg` as well: the design system's own
  field steps down at that breakpoint.
- **Comments, replies, nothing deeper.** A thread is a comment and its answers,
  and an answer to an answer is filed under the same top-level comment with the
  name of whoever it answers written above it. Depth is capped on purpose — the
  interfaces people already use work this way, and it means the whole discussion
  is one query and one indentation level rather than a tree to draw.
- **The heart is a favourite.** The same table and the same conditional write as
  favouriting a lesson, keyed `COMMENT#{commentId}` in a learner's own partition
  — so a double tap is one like and one increment, and `POST`/`DELETE` answer
  with the new count rather than the client asking again. The count on the row
  is written from that answer, so the heart fills on the press and not a request
  later.
- **Liked-by-me travels with the thread.** `GET` on a lesson's comments reads the
  caller's comment favourites in the same breath and marks each comment, the way
  a list of loops is marked: a discussion of a few dozen rows would otherwise be
  a request per heart.
- **A box that is always there**, on an empty discussion as much as a busy one —
  the first comment on a lesson is the one nobody has written yet, and hiding the
  box behind a button says the opposite. The same composer is the reply box and
  the editor: what changes is what is being written and what the button says.
  Enter writes the next line and `⌘↵` posts, because a comment is prose and a
  stray newline should not send half a thought.
- **Nobody's words but their own.** Any member may comment, reply and heart —
  this is a reading act, not an editorial one, so the tab asks for no role at
  all. Only the author may edit what they wrote, and an admin or editor may take
  a comment down without being able to rewrite it: the kebab shows the two as
  different things, and only one of them appears. Deleting a comment that has
  answers empties it and leaves the row, so the replies keep the comment they
  were written under and the thread still reads as one.
- **A comment is authorized like the lesson it is on, not like the organization
  that owns it.** Reading one, hearting one, and editing or deleting your own all
  ask whether you may read the lesson — a discussion is part of a classroom, and
  the people in a classroom are the people taking the course, who belong to the
  course and often to nothing else. Moderating somebody else's comment is still
  an admin's or editor's role in the organization, and the video a lesson plays
  is authorized the same way.
- **`@1:12` points at a moment** (`lib/timecode.ts`). A time written after an `@`
  — `@1:12`, `@00:01:12`, and a fraction of a second after either — is drawn in
  the sentence's own type and in the blue of a link, and tapping it puts the
  playhead there and starts it, so "what happens at `@00:01:12`?" is asked _at_
  00:01:12 rather than about it. It is set as prose rather than as a control of
  its own because that is what it is: a time in a sentence is part of the
  sentence, and only the colour says it can be tapped. The `@` is the whole of
  the syntax and the whole of the test — a discussion about a lesson is full of
  times, and "we shot this at 12:30" is a sentence about the day. Two parts are
  minutes and seconds and three are hours on top of them, and the time reads back
  in the app's own clock (`1:12`), because what is being pointed at is a moment,
  not a string. A time no clock has (`@70:00`) stays the words it was written as,
  and so does every time in a lesson with no video to seek in: a control that
  moves nothing is worse than plain text. The box says so in its own footer,
  since a syntax nobody is told about is one nobody uses.
- **Emoji are typed, not reacted with** (`lib/emoji.ts`,
  `components/content/emoji-picker.tsx`). A curated, searchable palette — 228 of
  them in eight groups, each with the words somebody might search for — inserted
  at the caret of whatever box is open, with the last handful used kept in
  `localStorage`, because which emoji somebody reaches for is a habit and not a
  fact about the lesson. It is drawn in a portal positioned against the window
  rather than in the comment list, because that list scrolls inside the lesson
  panel: a popover placed in the flow of it is clipped the moment it has to open
  past the top of the scroller, which is exactly when there is most to show.

### Routes

The active organization is part of the URL, so every page is deep-linkable and
survives a refresh:

| Route                                              | Page                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/`                                                | Resolves to your first organization, or the create form if you have none     |
| `/o/{orgId}`                                       | Home — recent videos and what the organization has                           |
| `/o/{orgId}/videos`                                | The organization's video library                                             |
| `/o/{orgId}/videos/new`                            | Upload into this organization                                                |
| `/o/{orgId}/videos/{videoId}`                      | Video detail (general / thumbnail / transcriptions)                          |
| `/o/{orgId}/videos/{videoId}/preview`              | Player, audio-only mode, synced transcript                                   |
| `/o/{orgId}/spaces`                                | The organization's spaces (courses)                                          |
| `/o/{orgId}/spaces/new`                            | Create a space — type, colour, cover                                         |
| `/o/{orgId}/spaces/{spaceId}`                      | Space detail — the course outline: its sections and the content under them   |
| `/o/{orgId}/spaces/{spaceId}/contents/{contentId}` | The classroom — a lesson: video, animated transcript, notes, files, comments (the panel arrangement) |
| `/o/{orgId}/members`                               | The roster, invitations not yet accepted, and the role reference             |
| `/o/{orgId}/settings`                              | Organization details and your role                                           |
| `/organizations`                                   | Every organization you belong to, and the invitations waiting for you        |
| `/organizations/new`                               | Create an organization                                                       |

`/o/{orgId}/*` renders inside the shell; the two `/organizations` pages sit
outside it (there is no active community there) with their own plain header.

Because the organization is in the route, the upload form no longer asks which
organization to use — you upload into the community you are already in.

Two things in the reference layout were deliberately left out rather than faked:
the search / notifications / messages / bookmark icons in the top bar, and the
"Add link" affordance in the sidebar. Neither has a backing feature, so the top
bar carries the theme toggle and the account menu instead, and the sidebar's
links are the organization's own sections: every one of the five opens a page.

## Prerequisites

- Node.js 20+ and npm
- AWS CLI v2 configured with credentials (see [AWS profile](#aws-profile) below)
- `openssl` (for the CloudFront key pair)

## AWS profile

Every script in this repository reaches AWS through one profile, and that profile
is named in exactly one place — **`scripts/api-config.env`**:

```sh
API_AWS_PROFILE=your-aws-profile-name
```

The bash scripts under `services/api/scripts/` source that file, and the two Node
scripts (`scripts/get-env.mjs` and
`services/api/scripts/backfill-video-organizations.js`) parse it — so no other
file needs to know the name. An `AWS_PROFILE` already in the environment _wins_
over the file, which is how you point one shell somewhere else without editing
anything:

```bash
AWS_PROFILE=personal npm run get-env
```

Configure the profile once (everything here also assumes **`us-east-1`**, which
`--region=<name>` overrides):

```bash
# the profile scripts/api-config.env names
aws configure --profile your-aws-profile-name
# AWS Access Key ID: ...
# AWS Secret Access Key: ...
# Default region name: us-east-1
# Default output format: json
```

This writes to `~/.aws/credentials` and `~/.aws/config`.

`cdk` is the one tool that cannot read that file — it takes the profile from the
environment, and has no `--profile` flag of its own — so a shell you deploy from
reads it out of the file once:

```bash
export AWS_PROFILE="$(. scripts/api-config.env && printf %s "$API_AWS_PROFILE")"
```

Individual commands still take `--profile=<name>` (the `aws` CLI and the bash
scripts) to point somewhere else for one run.

## Where configuration lives

| What                                                  | Where                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The AWS profile every script uses                     | `scripts/api-config.env` (an `AWS_PROFILE` in the environment wins)                  |
| CloudFront signing key pair                           | AWS SSM Parameter Store (see below) — **not** `.env`                                 |
| Which resources exist already (tables, bucket, pool)   | `infra/config/play-<stage>.json`, discovered by `import-state`                        |
| Google OAuth client id/secret                         | AWS SSM Parameter Store (see [Google sign-in](#google-sign-in-optional))             |
| Backend stage/region                                  | `--context stage=…` on `cdk deploy`; `infra/config/play-<stage>.json` names the resources it stands on |
| Frontend API/Cognito values                           | `apps/studio/.env.local`, `apps/marketplace/.env.local`                              |
| Where an _author's_ email points (organization invitations) | `mail.appBaseUrl` in `infra/config/play-<stage>.json`, written by `set-mail-sender.sh` |
| Where everything a _learner_ is sent points (rewards, course invitations) | `mail.marketplaceBaseUrl`, in the same file<br>(set from the Play console's Settings form) |

The backend has **no `.env` requirements** — the CloudFront private key is read
from SSM at runtime, by name, and cached for the life of the container
(`services/api/src/lib/cloudfront-key.ts`). It is deliberately not in the
Lambdas' environment: at 2.3 KB it was most of Lambda's 4 KB budget, and a
private key readable in the console from a hundred functions that never sign
anything.

## 1. Deploy the backend

```bash
npm install
export AWS_PROFILE="$(. scripts/api-config.env && printf %s "$API_AWS_PROFILE")"

# Generate the CloudFront key pair (for signed URLs) and write it to SSM
./services/api/scripts/generate-cloudfront-keypair.sh

# Once per account and region, before the first deploy
npm run bootstrap
```

The script stores the key material in SSM Parameter Store:

- `/play/cloudfront/private-key` (SecureString) — base64 PKCS#8 private key
- `/play/cloudfront/public-key` (String) — PEM public key (`BEGIN/END PUBLIC KEY`)

Then deploy — four stacks, and `cdk` takes the profile from the environment
rather than from a flag (see [AWS profile](#aws-profile)):

```bash
npm run diff     # what would change, before it does
npm run deploy   # = cdk deploy --all, against $AWS_PROFILE
```

Three of the four stacks create almost nothing: the tables, the bucket, the
distribution and the user pool already exist and are **imported**, so a deploy
will not change or delete them. Read
[infra/README.md](infra/README.md) for the map, and
[docs/migration.md](docs/migration.md) for what that means in practice — in
short, a few operations (the pool's callback URLs, its pre sign-up trigger, the
CloudFront key) are API calls rather than deploys, and each has a script.

The values the frontend needs come from the stacks, and one command writes them:

```bash
npm run get-env   # reads PlayApiStack and PlayAuthStack into each app's .env.local
```

> **Key rotation:** the CloudFront public key is an *imported* resource, so
> rotating the signing key is a CloudFront API call rather than a deploy.
> `generate-cloudfront-keypair.sh` writes the new key material to SSM and ends
> with the two commands that apply it. Until both are done — the public key
> updated, and the API redeployed so no container is still signing with the old
> private key — a player will load and never start.

## 2. Run the apps

From the repository root, once:

```bash
npm install
```

Each app reads the same stack outputs into its own `.env.local`. From the root,
`npm run get-env` writes both:

```bash
npm run get-env
```

or one at a time, from the app's own directory:

```bash
cd apps/studio
npm run get-env
cd ../marketplace
npm run get-env
```

This runs `scripts/get-env.mjs`, which reads the `play-backend-dev` stack outputs
and writes the app's `.env.local`:

```bash
NEXT_PUBLIC_API_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

When the backend was deployed with Google sign-in enabled it also writes:

```bash
NEXT_PUBLIC_COGNITO_DOMAIN=play-dev-123456789012.auth.us-east-1.amazoncognito.com
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true
```

(You can also create `.env.local` manually from `.env.local.example`.)

Then start either app — or both, in two terminals:

```bash
npm run dev:studio        # Play Studio      → http://localhost:3000
npm run dev:marketplace   # Play Marketplace → http://localhost:3001
npm run dev:demo          # Play Demo        → http://localhost:4000
```

The two apps share one user pool, so the same account works in both: sign in to
the studio, create an organization, upload a video, build a course, publish it —
then open the marketplace on port 3001 and it is there to register for. Cognito
only redirects to URLs it was told about, and the backend's
`custom.authDefaults` registers `localhost:3000` **and** `localhost:3001`; a
deployment that overrides `/play/auth/callback-urls` in SSM must list both.

The studio also reads `NEXT_PUBLIC_MARKETPLACE_URL` (unset by default): set it to
the marketplace's address (`http://localhost:3001`) and a published course's
overview links straight to it in the catalog.

Open http://localhost:3000, create an account (email verification code is sent
to the sign-up email), create an organization, then upload a video into it.

## The marketplace

The learner's side, and the only part of this repository that is readable without
an account:

| Route                                    | What it is                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                      | The front page: what the marketplace is, what a lesson looks like, what learners say about it, and the newest courses — and nothing to press but **Discover courses** |
| `/discover`                              | The catalog: every course its author has listed, with covers, lesson counts and how many people are taking it, and one box to search them with                        |
| `/courses/{spaceId}`                     | One course — its syllabus, section by section — and the button that registers you for it                                                                              |
| `/courses/{spaceId}/lessons/{contentId}` | The lesson itself: the shared classroom in its reading arrangement, with no top bar and the whole window                                                              |
| `/courses/{spaceId}/rewards`             | What this course has given you: the codes, what they are for, and how to use them                                                                                     |
| `/join/{spaceId}`                        | Where a course invitation is claimed: the offer itself for somebody who is signed in, and the sign-in screen with "Join Acme" over it for somebody who is not          |
| `/my-courses`                            | The courses you are registered for, wherever they came from                                                                                                           |
| `/favourites`                            | The lessons you have hearted, newest first, with the course each came from                                                                                            |
| `/sign-in`                               | Amplify's sign-in, then straight back to whatever you were doing (`?next=`)                                                                                           |

The catalog used to _be_ `/`. It is its own page now — a name in the top bar
(**Discover**) rather than the front door — because somebody who has never heard
of Play needs a sentence about the thing before they need a table of contents.
The front page is written for that visitor: a claim, three steps, what the
classroom does, reviews written for the page, and a link to Discover. It reads
the catalog for the one block that is not a claim — the newest courses — and
shows nothing at all when there is nothing to show.

**Browsing is public; registering is the only thing that asks who you are.** Two
of its routes carry no authorizer at all — `GET /catalog/courses` and
`GET /catalog/courses/{spaceId}` — because a catalog behind a login is a catalog
nobody reads, and what they serve is what a course says about itself in public:
its title, its description, its cover (as a signed URL), its counts, and the
titles of its lessons. Nothing about the people in it, and no lesson content.

Registering is `POST /spaces/{spaceId}/enrollment`: signed in, idempotent, and it
claims an invitation already addressed to you rather than writing a second
membership — so somebody invited as an assistant who registers through the
catalog is an assistant, not a student. `DELETE` on the same path leaves the
course; the course itself is untouched, and your progress is kept if you register
again.

### Being given something

A reward handed to somebody by hand — the discount an instructor promised, the
gift card for the person who answered a question well — sends them an email. The
grant is written first and the letter follows, so a mail failure costs a
notification and never the reward; the author's dialog says whether it went out,
and why not when it did not, because a reward that arrives silently is one nobody
redeems.

The link lands on `/courses/{spaceId}/rewards` in the **marketplace**, not the
studio: the person being given something is taking the course, and the studio is
where courses are written. It points at that course's rewards rather than at a
list of everything, so what the email promised — _this_ reward, in _this_ course
— is what is on screen when it opens, with the code on one line and a tap to
copy it.

That is why there are two addresses in the mail configuration, and the line
between them is *who the letter is for* rather than which kind of letter it is.
`marketplaceBaseUrl` is where anything addressed to somebody taking a course
points — a reward, and a **course invitation** (`/join/{spaceId}`) — because the
marketplace is the app courses are taken in. `appBaseUrl` is what is left: the
organization invitation, which is an offer to join the place courses are
*written*, and the studio is the only app that has an organization page to show.
Both default to localhost, and both must be set to the deployed app before either
letter is sent to anybody real — the studio one by `set-mail-sender.sh`, the
marketplace one from the Play console's Settings form, which is where
`MARKETPLACE_BASE_URL` is written.

A grant issued by a _milestone_ — finishing a course, reaching a percentage —
does not email: it already arrives in the classroom, with a toast and the
rewards tab, and the reader is looking at the thing they just finished.

A course appears in the catalog when its author lists it. That is a toggle on the
course's overview in the studio (see [Spaces](#spaces-courses)), and it writes
the sparse `CatalogCreatedIndex` key alongside the flag: the index holds
published courses, so Discover is a query rather than a scan of every course in
the service.

A reader in the course sees the same course page whether it is listed or not: the
marketplace reads the catalog first and, if that says 404 _and_ they are enrolled,
reads the member endpoints instead. A course somebody was invited to and whose
author never published is still theirs to take.

## Google sign-in (optional)

Users can sign in with Google instead of a password. This is **Cognito
federation**: the app redirects to the Cognito Hosted UI with
`identity_provider=Google`, Cognito performs the OAuth 2.0 handshake with Google
(Authorization Code flow + PKCE), and the app receives Cognito tokens — so the
API Gateway `COGNITO_USER_POOLS` authorizer and every backend handler keep
working unchanged. Email/password sign-in stays available next to it.

A Google account becomes a **federated user**: a profile Cognito creates in this
same user pool from Google's claims on first sign-in — no password, status
`EXTERNAL_PROVIDER`, an `identities` attribute recording the provider, and a
derived `Google_<sub>` username. To the rest of the stack it is an ordinary user:
same token format, same authorizer, same `sub`-based ownership. Federated users
can only sign in through the Hosted UI, never `InitiateAuth`.

The whole feature is optional and driven by SSM parameters: with no Google
credentials stored, neither the identity provider nor the Hosted UI domain is
created, and sign-in works exactly as before with email and password.

### 1. Create a Google OAuth client

In the [Google Cloud Console](https://console.cloud.google.com/) → **APIs &
Services** → **Credentials**:

1. Configure the OAuth consent screen. Add **`amazoncognito.com`** to
   _Authorized domains_ — Google requires it when the redirect target is a
   Cognito domain — and include the `.../auth/userinfo.email`,
   `.../auth/userinfo.profile` and `openid` scopes.
2. Create an **OAuth client ID** of type **Web application**. The two URLs it
   asks for are printed by the next step (they contain your Cognito domain,
   which does not exist yet).

### 2. Store the credentials

```bash
cd services/api
./scripts/set-google-oauth.sh
```

The script prompts for the client id/secret (the secret is read without echo),
writes them to SSM Parameter Store, configures the Google identity provider on
the user pool, and prints the exact values to paste into the Google client. The
pool is **imported** by `infra`, so this is an API call rather than a deploy —
there is no stack that owns it to change it.

> **A pool this repository *creates*** — a new environment, whose `ownership.auth`
> is `true` — is a different story. Its provider is built at deploy time from
> `auth.googleClientId` and a client secret in Secrets Manager, both written by
> the console's **Settings** view ([apps/play/README.md](apps/play/README.md)).
> This script does not apply to it: there is no pre-existing pool to call.
> CloudFormation refuses an SSM Secure reference in the identity provider, which
> is why the secret is a Secrets Manager secret at
> `play/<stage>/google-client-secret`.

| Google client field           | Value                                         |
| ----------------------------- | --------------------------------------------- |
| Authorized JavaScript origins | `https://<cognito-domain>`                    |
| Authorized redirect URIs      | `https://<cognito-domain>/oauth2/idpresponse` |

For a pool this repository creates, the console's Checklist tab prints both of
these with the right `<cognito-domain>` filled in — derived as
`play-<stage>-<account>.auth.<region>.amazoncognito.com` while the environment is
still nothing but a name, and read off the deployed pool once there is one.

Parameters written (secret stored as `SecureString`):

- `/play/auth/google-client-id`
- `/play/auth/google-client-secret`
- `/play/auth/callback-urls` (comma-separated, default: both apps on localhost)
- `/play/auth/logout-urls` (comma-separated, default: both apps on localhost)

Override the URL lists with `--callback-urls=` / `--logout-urls` — they must
contain every origin the app is served from (dev and deployed), and must match
the app's `NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN` / `_SIGN_OUT`. In development
neither app sets those: `@play/auth` derives them from the origin the browser is
on, so the studio gets `localhost:3000/auth/callback` and the marketplace
`localhost:3001/auth/callback`.

> **Adding an app or a port?** The user pool is imported, so the list it accepts
> is not deployed — it is written. A new origin that is not on it fails to sign
> in with `redirect_mismatch`, which looks like a broken app rather than a missing
> entry:
>
> ```bash
> node services/api/scripts/set-auth-urls.mjs --callback-urls="…"   # applies immediately
> node services/api/scripts/set-auth-urls.mjs --show                # what Cognito accepts now
> ```
>
> The script reads the app client before writing it, because Cognito's update
> calls reset every attribute they are not given.

### 3. Deploy and refresh the apps' env

```bash
node services/api/scripts/set-auth-urls.mjs   # if an app or port is new

cd ../apps/studio
npm run get-env   # adds COGNITO_DOMAIN + GOOGLE_AUTH_ENABLED
npm run dev
```

The marketplace reads the same two values, so run `npm run get-env` from
`apps/marketplace` too — or once from the repository root, which writes both:

```bash
cd ../.. && npm run get-env
```

The sign-in screen now shows **Sign In with Google**. Restart the dev server so
the new `.env.local` values are picked up.

### What gets created

| Resource                                               | Purpose                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS::Cognito::UserPoolDomain`                         | Hosted UI (`/oauth2/authorize`, `/oauth2/token`). Cognito requires a domain for any federated sign-in. Pinned to hosted UI classic (`ManagedLoginVersion: 1`) because managed login needs a branding style that Cognito only applies to console-created app clients. |
| `AWS::Cognito::UserPoolIdentityProvider`               | The Google IdP, with `email`, `email_verified`, `given_name`, `family_name`, `name`, `picture` mapped.                                                                                                                                                               |
| `CognitoUserPoolClient` OAuth settings                 | `code` flow, `openid email profile` scopes, callback/logout URLs, and `COGNITO` + `Google` as supported providers.                                                                                                                                                   |
| `link-federated-user` Lambda + `LinkFederatedUserRole` | Pre sign-up trigger that links a first-time Google sign-in to the password account with the same verified email (see [Same email, same account](#same-email-same-account)).                                                                                          |
| Stack outputs `CognitoDomain`, `GoogleAuthEnabled`     | Consumed by `npm run get-env` to configure the frontend.                                                                                                                                                                                                             |

### How the frontend signs in

1. `Authenticator` renders the Google button (`socialProviders={['google']}`
   whenever `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` is `true`) and calls
   `signInWithRedirect({ provider: 'Google' })`.
2. Amplify stores the PKCE verifier + state in session storage and redirects to
   the Hosted UI, which redirects to Google.
3. Google returns to `https://<cognito-domain>/oauth2/idpresponse`, Cognito
   creates/loads the user profile, and redirects to the app's callback URL
   (`/auth/callback` by default) with `?code=…&state=…`.
4. `aws-amplify/auth/enable-oauth-listener` — imported by
   `apps/studio/src/lib/amplify.ts` so it is present on **every** route, as
   required for multi-page apps — picks the code up on page load, exchanges it
   for tokens, and dispatches the `signInWithRedirect` / `signedIn` Hub events.
5. `/auth/callback` (`apps/studio/src/app/auth/callback/page.tsx`) waits for
   the session, surfaces failures, and forwards the user to `/`.

Sign-out is OAuth-aware automatically: for a federated user Amplify ends the
session at Cognito's `/logout` endpoint (clearing the Hosted UI session cookie
too) and returns to `NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT`. Password users are
unaffected.

### Same email, same account

A first-time Google sign-in is linked to an existing password account with the
same email address, so one person keeps one `sub` and one video library — videos
are scoped to `ownerId` (the `sub`), so without this an email/password user and a
Google user with the same address would be two different people.

Cognito does not do this by itself:

> When a federated user signs in to your user pool for the first time, Amazon
> Cognito looks for a local profile that you have linked to their identity. **If
> no linked profile exists, your user pool creates a new profile.**

So the linking happens in the `link-federated-user` **Pre sign-up trigger**,
which Cognito invokes with `triggerSource: PreSignUp_ExternalProvider`
immediately _before_ it creates the federated profile. The handler:

1. Requires verified email on **both** sides — `email_verified` is mapped from
   Google's own claim, and the local profile's `email_verified` must be `true`.
   Linking on an unverified address would let anyone who can receive mail at a
   victim's address inherit their account.
2. Finds the local profile with `ListUsers` (`email = "…"`), skipping federated
   profiles (they carry an `identities` attribute) and taking the oldest match.
3. Calls `AdminLinkProviderForUser` with the local profile as `DestinationUser`
   and Google as `SourceUser`, using `ProviderAttributeName: Cognito_Subject`
   with the provider's `sub` — the derived `Google_<sub>` username already
   carries it. Social IdPs can only be linked by subject, never by email.

Then Cognito finds the linked profile and signs the user into it.

Two things worth knowing:

- **Only `Google` is linked**, because social IdPs link via `Cognito_Subject`;
  an OIDC or SAML provider would use a mapped claim name instead.
- **A failed link never blocks sign-in.** The handler catches its own errors and
  logs them (`link-federated-user:` in CloudWatch); the user then gets a separate
  federated profile, exactly as before this existed. Check the log if a link is
  expected but does not happen.

The function has its own IAM role (`LinkFederatedUserRole`) rather than the
shared Lambda role, since `AdminLinkProviderForUser` can attach an external
identity to any local account. That role grants `cognito-idp:ListUsers` and
`AdminLinkProviderForUser` on `arn:…:userpool/*` — an ARN pattern rather than the
pool's own ARN, because the pool's `LambdaConfig` already references the function
and pointing the role back at the pool would close a CloudFormation dependency
cycle.

#### Migrating accounts that already signed in with Google

Linking only takes effect for a **first** federated sign-in, so any Google
profile created before this trigger existed keeps being used and must be deleted
first. Find them by their `Google_` username prefix, and check nothing is
attached to the old `sub` before deleting:

```bash
POOL=$(aws cloudformation describe-stacks --stack-name play-backend-dev \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" --output text)

aws cognito-idp list-users --user-pool-id "$POOL" \
  --query 'Users[?starts_with(Username, `Google_`)].{Username:Username,Email:Attributes[?Name==`email`].Value|[0]}'
```

Videos are owned by `sub`, which for a federated profile is the part after
`Google_`. Confirm the old profile owns none, then delete it (the next Google
sign-in re-creates the identity, this time linked):

```bash
aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username Google_100917265935340268751
```

Deleting a federated profile that _does_ own videos would orphan them: they would
remain in DynamoDB and S3 under the old `sub`, unreadable by the linked account.

### Caveats

- Federated usernames are derived by Cognito (`Google_<sub>`), not mapped, so the
  `username` attribute is deliberately left out of the attribute mapping.
- Mapped addresses are unverified unless `email_verified` is mapped, which is why
  the IdP maps it from Google.
- Changing the callback/logout URLs requires both an SSM update (and redeploy to
  update the Cognito app client) and the matching frontend env vars.
- Linking trusts Google's `email_verified` claim. If you ever add a provider that
  returns unverified addresses, tighten the guard in
  `services/api/src/functions/auth/link-federated-user.ts` before enabling it.

To turn Google sign-in off again:

```bash
cd services/api
./scripts/set-google-oauth.sh --delete          # removes the identity provider
node scripts/set-auth-urls.mjs --no-google      # and stops the client offering it
```

> Deleting the Hosted UI domain invalidates the existing hosted UI session
> cookies; users simply sign in again with their password.

## Playback & quality selection

The player is **Video.js** (the `@videojs/react` package), using the `video`
preset and the `HlsJsVideo` media element for HLS. Playback is adaptive by
default, and the built-in **settings menu** (gear icon) provides a quality
selector — `Auto` plus every rendition in the HLS master playlist:

- Reads renditions dynamically, so it shows everything the video was transcoded
  with (144p–1080p, or more if you extend the ladder in
  `services/api/src/lib/mediaconvert.ts`).
- The CloudFront signature is applied to every manifest/segment request via
  hls.js `xhrSetup` (passed through `config.hlsJs` on `HlsJsVideo`).

### Sound, and why a lesson can open quietly

A lesson opens playing — a thing you came to watch should not need pressing —
but no browser lets a page that started itself _speak_, so the player asks for
sound and takes silence if it is refused, because a lesson playing quietly is
one whose volume can be turned up while one that never started is one that has
to be pressed. That is the browser's rule, not a setting here, and a reload is
exactly when it applies: a fresh page load has no gesture behind it.

What the player does about it:

- A **"Tap for sound"** button sits over the picture whenever the sound was
  refused, and any click or keypress anywhere on the page restores it too — both
  are the same gesture the browser accepts, and the button just says so.
- The reader's own choice is remembered in `localStorage` as `play:sound`, so
  muting one lesson does not mean being talked at by the next one, and unmuting
  one is tried again on the next. Only a choice the _reader_ made is stored: a
  mute the player applied because the browser refused is not an opinion.

## REST API

All endpoints require `Authorization: Bearer <Cognito ID token>`.

| Method | Path                                                   | Description                                                            |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| POST   | `/videos`                                              | Create a video in an organization + presigned S3 upload URL            |
| GET    | `/videos`                                              | List the caller's own uploads                                          |
| GET    | `/videos?organizationId=`                              | List an organization's whole library (any member)                      |
| GET    | `/videos/{id}`                                         | Get a single video                                                     |
| PATCH  | `/videos/{id}`                                         | Update title/description                                               |
| DELETE | `/videos/{id}`                                         | Delete metadata + S3 objects (blocked while encoding)                  |
| POST   | `/videos/{id}/retry`                                   | Retry processing of a `FAILED` video                                   |
| GET    | `/videos/{id}/stream`                                  | Return a signed CloudFront URL for HLS playback                        |
| GET    | `/videos/{id}/audio`                                   | Return a signed CloudFront URL for the audio track                     |
| POST   | `/videos/{id}/audio`                                   | Extract audio for a video that has none                                |
| POST   | `/videos/{id}/subtitles`                               | Generate subtitles (AWS Transcribe → WebVTT)                           |
| GET    | `/videos/{id}/subtitles`                               | Return a signed CloudFront URL for the subtitle file                   |
| GET    | `/videos/{id}/thumbnail`                               | Return a signed CloudFront URL for the thumbnail                       |
| PUT    | `/videos/{id}/thumbnail`                               | Upload a custom thumbnail (returns presigned PUT URL)                  |
| POST   | `/videos/{id}/thumbnail/frame`                         | Capture the first frame as the default thumbnail                       |
| POST   | `/organizations`                                       | Create an organization (the caller becomes its admin)                  |
| GET    | `/organizations`                                       | List the organizations the caller belongs to                           |
| GET    | `/organizations/{orgId}`                               | Get one organization (members only)                                    |
| GET    | `/organizations/{orgId}/members`                       | The roster: members and unaccepted invitations (members only)          |
| POST   | `/organizations/{orgId}/members`                       | Invite an email address with a role (admins only)                      |
| PATCH  | `/organizations/{orgId}/members/{userId}`              | Change a member's role (admins only)                                   |
| DELETE | `/organizations/{orgId}/members/{userId}`              | Remove a member, or revoke an invitation (admins only)                 |
| POST   | `/organizations/{orgId}/members/{userId}/invitation`   | Send an invitation again, optionally correcting its role (admins only) |
| POST   | `/organizations/{orgId}/invitation`                    | Accept the invitation addressed to your own email                      |
| GET    | `/me/invitations`                                      | Invitations addressed to the caller, in every organization             |
| POST   | `/organizations/{orgId}/spaces`                        | Create a space (course) in an organization                             |
| GET    | `/organizations/{orgId}/spaces`                        | List the organization's spaces                                         |
| GET    | `/spaces/{spaceId}`                                    | Get one space (members only)                                           |
| GET    | `/spaces/{spaceId}/thumbnail`                          | Return a signed CloudFront URL for the cover                           |
| PUT    | `/spaces/{spaceId}/thumbnail`                          | Upload a cover (returns a presigned PUT URL)                           |
| POST   | `/spaces/{spaceId}/sections`                           | Add a section to a space                                               |
| GET    | `/spaces/{spaceId}/sections`                           | The space outline: sections, each with its content                     |
| GET    | `/sections/{sectionId}`                                | Get one section                                                        |
| PATCH  | `/sections/{sectionId}`                                | Rename a section, rewrite it, or move it                               |
| DELETE | `/sections/{sectionId}`                                | Delete a section **and the content under it**                          |
| POST   | `/sections/{sectionId}/contents`                       | Add content to a section                                               |
| GET    | `/sections/{sectionId}/contents`                       | List a section's content (paged)                                       |
| GET    | `/contents/{contentId}`                                | Get one piece of content, plus the caller's own state                  |
| PATCH  | `/contents/{contentId}`                                | Change its title, video, notes, or position                            |
| DELETE | `/contents/{contentId}`                                | Delete it, its files, and its comments                                 |
| PUT    | `/contents/{contentId}/files`                          | Attach a file (returns a presigned PUT URL)                            |
| GET    | `/contents/{contentId}/files`                          | List its attachments, each with a signed URL                           |
| GET    | `/contents/{contentId}/files/{fileId}`                 | Signed URL for one attachment                                          |
| DELETE | `/contents/{contentId}/files/{fileId}`                 | Detach one attachment                                                  |
| PUT    | `/contents/{contentId}/placement`                      | Move a lesson or quiz within or between sections (a drag)              |
| GET    | `/organizations/{orgId}/question-banks`                | The organization's question banks                                      |
| POST   | `/organizations/{orgId}/question-banks`                | Make a question bank                                                   |
| GET    | `/banks/{bankId}`                                      | One bank, with the last AI run against it                              |
| PATCH  | `/banks/{bankId}`                                      | Rename a bank, or rewrite what it says                                 |
| DELETE | `/banks/{bankId}`                                      | Delete a bank **and its questions**, out of every quiz asking them     |
| GET    | `/banks/{bankId}/questions`                            | A bank's questions, with the bank and the unverified count             |
| POST   | `/banks/{bankId}/questions`                            | Write a question (a lesson is required)                                |
| POST   | `/banks/{bankId}/questions/import`                     | Import questions from .xlsx/.csv/.json (base64 in the body)            |
| POST   | `/banks/{bankId}/questions/generation`                 | Queue an AI generation from a lesson (`202`); `DELETE` forgets it      |
| POST   | `/banks/{bankId}/questions/verification`               | Verify a batch of a bank's questions                                   |
| PATCH  | `/questions/{questionId}`                              | Edit a question (takes its verification away)                          |
| DELETE | `/questions/{questionId}`                              | Delete it from its bank, and out of every quiz asking it               |
| PUT    | `/questions/{questionId}/verification`                 | Verify it (`DELETE` takes that back)                                   |
| GET    | `/spaces/{spaceId}/questions`                          | Every question about a course's lessons, from every bank               |
| GET    | `/contents/{contentId}/questions`                      | What a quiz asks, in order, each with its bank and lesson              |
| POST   | `/contents/{contentId}/questions`                      | Add questions from banks to a quiz                                     |
| DELETE | `/contents/{contentId}/questions/{questionId}`         | Stop asking it — the question stays in its bank                        |
| PUT    | `/contents/{contentId}/questions/placement`            | Move it in the quiz's order                                            |
| POST   | `/contents/{contentId}/questions/verification`         | Verify a batch of the quiz's questions                                 |
| GET    | `/contents/{contentId}/quiz`                           | A quiz as a learner is handed it: the questions without the answers    |
| POST   | `/contents/{contentId}/quiz/check`                     | Whether one answer is right — records nothing                          |
| POST   | `/contents/{contentId}/quiz/attempts`                  | Hand in an answer sheet and be marked (`201`)                          |
| PUT    | `/contents/{contentId}/favourite`                      | Favourite it (any member)                                              |
| DELETE | `/contents/{contentId}/favourite`                      | Unfavourite it                                                         |
| PUT    | `/contents/{contentId}/playlist`                       | Add it to the caller's learning playlist                               |
| DELETE | `/contents/{contentId}/playlist`                       | Remove it from it                                                      |
| GET    | `/me/favourites`                                       | Everything the caller has favourited (`?type=CONTENT` for one kind)    |
| GET    | `/me/playlist`                                         | The caller's learning playlist                                         |
| GET    | `/contents/{contentId}/comments`                       | Its discussion, as two-level threads                                   |
| POST   | `/contents/{contentId}/comments`                       | Comment on it, or reply to a comment                                   |
| PATCH  | `/contents/{contentId}/comments/{commentId}`           | Edit a comment (its author only)                                       |
| DELETE | `/contents/{contentId}/comments/{commentId}`           | Delete a comment                                                       |
| PUT    | `/contents/{contentId}/comments/{commentId}/favourite` | Favourite a comment                                                    |
| DELETE | `/contents/{contentId}/comments/{commentId}/favourite` | Unfavourite it                                                         |
| POST   | `/contents/{contentId}/loops`                          | Save a named stretch of the video as a loop                            |
| GET    | `/contents/{contentId}/loops`                          | The caller's own loops on this lesson                                  |
| PATCH  | `/contents/{contentId}/loops/{loopId}`                 | Rename, recolour, or move one of its ends                              |
| DELETE | `/contents/{contentId}/loops/{loopId}`                 | Delete it                                                              |
| PUT    | `/contents/{contentId}/loops/{loopId}/like`            | Like a loop                                                            |
| DELETE | `/contents/{contentId}/loops/{loopId}/like`            | Take the like back                                                     |
| PUT    | `/contents/{contentId}/completion`                     | Mark the lesson done for the caller                                    |
| DELETE | `/contents/{contentId}/completion`                     | Take it back off the done list                                         |

`GET /videos` accepts `status`, `limit`, and `nextToken`; `?organizationId=` can
be combined with `status`.

### Video lifecycle

1. `POST /videos` names an `organizationId` the caller is an admin or editor of,
   → status `UPLOADING`, returns presigned PUT URL.
2. Frontend uploads the file directly to S3 (never through Lambda).
3. S3 `ObjectCreated` event → `process-video` Lambda sets status `PROCESSING`
   and submits a MediaConvert HLS job. In parallel it starts an AWS
   **Transcribe** job (`subtitles/{videoId}/`) to generate a WebVTT subtitle
   file, and a frame-capture job (`thumbnails/{videoId}/`) for the default
   thumbnail.
4. MediaConvert job state change → `video-processing-complete` Lambda sets
   status `READY` (storing the HLS master playlist key) or `FAILED`.
5. `GET /videos/{id}/stream` returns a signed CloudFront URL valid for 15 min.
6. If a video is `FAILED`, `POST /videos/{id}/retry` clears any partial output,
   re-submits the MediaConvert job, and returns the video to `PROCESSING`.

### Audio lifecycle

The same MediaConvert job that builds the HLS ladder also produces a standalone
audio track (AAC in an MP4 container) under `processed/{videoId}/audio/`, so
every upload automatically gets an audio-only version:

1. The audio-only output group writes `processed/{videoId}/audio/audio.mp4`.
2. On completion, `video-processing-complete` stores the `audioKey` on the video
   (alongside `manifestKey`).
3. `GET /videos/{id}/audio` returns a signed CloudFront URL scoped to
   `processed/{videoId}/audio/*`, so the frontend can offer an **Audio only**
   player that streams the track without video.

For a `READY` video that has no audio (e.g. uploaded before audio extraction
existed, or whose extraction failed), `POST /videos/{id}/audio` submits a
MediaConvert job that extracts only the audio track. The completion event is
distinguished from the main encoding job via the job's `type` metadata, so it
updates just the `audioKey`/`audioStatus` and never flips the video's status.

### Thumbnail lifecycle

Every video gets a default poster — its own first frame — and a custom upload
replaces it:

1. `process-video` submits a frame-capture MediaConvert job alongside the
   encode, writing `thumbnails/{videoId}/frame-{timestamp}.jpg`.
2. On completion, `video-processing-complete` stores that key as the video's
   `thumbnailKey` — **only** if the video has no custom thumbnail, so a user
   upload always wins.
3. `PUT /videos/{id}/thumbnail` returns a presigned S3 PUT URL for a custom
   image under `thumbnails/{videoId}/` and points `thumbnailKey` at it.
4. `POST /videos/{id}/thumbnail/frame` re-runs the capture for a video that has
   no thumbnail yet (or whose first frame is unusable) — the backfill for videos
   processed before default thumbnails existed.
5. `GET /videos/{id}/thumbnail` returns a signed CloudFront URL scoped to
   `thumbnails/{videoId}/*` so the frontend can render the poster image.

### Subtitle lifecycle

Subtitles run independently of encoding (Transcribe reads the raw upload
directly), so a transcription failure never blocks playback:

1. On upload, `process-video` marks the video `subtitleStatus: GENERATING` and
   starts a Transcribe job. The job emits `Transcribe Job State Change` events.
2. `subtitle-generation-complete` handles the event: on `COMPLETED` it finds
   the `.vtt` under `subtitles/{videoId}/` and sets `subtitleStatus: READY`
   (storing `subtitleKey`); on `FAILED` it sets `subtitleStatus: FAILED`.
3. `GET /videos/{id}/subtitles` returns a signed CloudFront URL scoped to
   `subtitles/{videoId}/*`, so the player can load the WebVTT track.
4. If a video has no subtitles, the UI shows a **Generate subtitles** button
   (`POST /videos/{id}/subtitles`), which clears prior output and re-submits
   the job on demand.

Deletion (`DELETE /videos/{id}`) is rejected with `409` while the video is
`PROCESSING` (encoding), since an in-flight MediaConvert job would race with the
S3/DynamoDB cleanup.

### Organization lifecycle

An **organization** is the collaboration boundary: videos belong to one (see
[Videos belong to organizations](#videos-belong-to-organizations)), courses are
built inside one, and teammates are invited to it as an **admin**, **editor**,
or **viewer** (see [Members](#members), below).

1. `POST /organizations` takes a `name` (2–80 characters) and an optional
   `description` (≤ 500 characters); the caller is taken from the Cognito
   authorizer, never from the body.
2. The organization and the caller's membership are written together with
   `TransactWriteItems`, so an organization can never exist without at least one
   admin. The caller's role is `ADMIN`.
3. `GET /organizations` returns the organizations the caller belongs to,
   newest membership first. `GET /organizations/{orgId}` returns one, and
   authorizes on membership — being able to see an organization _is_ being a
   member of it. An invitation is not membership: both reads skip a row whose
   status is `INVITED`.

| Table                | Keys                              | Purpose                                                                                                                                                                      |
| -------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OrganizationsTable` | `orgId` (hash)                    | name, slug, description, ownerId, adminCount, timestamps                                                                                                                     |
| `OrgMembersTable`    | `orgId` (hash) + `userId` (range) | role (`ADMIN`/`EDITOR`/`VIEWER`), status, email, invitedEmail, invitedBy, joinedAt; GSIs `UserOrgIndex` (userId + joinedAt) and `InviteEmailIndex` (invitedEmail + joinedAt) |

Two tables instead of a members map embedded in the organization:

- The membership row is what every authorization check reads — it is the only
  thing that decides who can see or change an organization.
- "My organizations" is a single query on `UserOrgIndex`; a map inside the
  organization item would need a scan.
- Inviting someone, changing a role, or removing a member becomes a
  single-item write.

DynamoDB authorizes a transaction and the item-level actions inside it
_separately_ (see [Using IAM with DynamoDB
transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)),
which is why the Lambda role grants `dynamodb:TransactWriteItems` **and**
`dynamodb:PutItem` on both tables.

The slug is derived from the name and gets a short random suffix
(`acme-learning-9f2c41`), which keeps organizations addressable without a
uniqueness round-trip at creation time.

### Members

The roster is the membership rows of one organization, and the three roles are
the whole of what differs between them:

| Role       | Organization                             | Courses and videos                                            |
| ---------- | ---------------------------------------- | ------------------------------------------------------------- |
| **Admin**  | Manages the organization and its members | Everything an editor can do                                   |
| **Editor** | —                                        | Creates and edits courses, sections, lessons, and the library |
| **Viewer** | —                                        | Reads them; cannot change anything                            |

That split is one table in `src/lib/access.ts`: `read` is any active member,
`write` is an admin or editor, and managing members is an admin — checked by
`requireOrganizationAdmin`, so an editor curates courses without deciding who is
in the room.

An invitation is **not** a membership. The row is written with status `INVITED`,
which `requireOrganizationAccess` treats as no membership at all, so an
unaccepted offer grants nothing: not the roster, not the library, not the
courses. It is an offer, and it stays one until somebody takes it up.

1. `POST /organizations/{orgId}/members` takes an `email` and a `role`. The
   person does not have to have an account yet — the pool may never have heard
   of them — so **the row is keyed by the address**, which is the only
   identifier there is at that point. That is also why `invitedEmail` is stored
   separately from `email`: it records what the invitation was _for_, and it is
   what a later acceptance matches on.
2. Inviting an address that is already a member answers `409`; inviting one that
   is already invited re-sends the offer, role included. A conditional
   `PutItem` (`attribute_not_exists(userId) OR status = 'INVITED'`) is what keeps
   a re-invite from quietly rewriting a real member's role.
3. They are emailed a link to `/organizations`, and that page is where the offer
   is shown: it is the one read a person who belongs nowhere yet can make
   (`GET /me/invitations`, queried through `InviteEmailIndex` by _their own
   claim's_ address, so it cannot return an offer that was not addressed to
   them). `POST /organizations/{orgId}/invitation` claims one.
4. Accepting it **re-keys the row** from the address to the caller's Cognito
   `sub`, in a single `TransactWriteItems`, so the membership is never briefly
   absent. There is no token to carry and nobody approves: Cognito has already
   verified that the caller owns the address the invitation names, so being
   signed in as it _is_ the acceptance. `attribute_not_exists` on the new key
   makes a second acceptance — or accepting an invitation to an organization you
   already belong to — a no-op rather than a role rewrite.

Admins change roles through `PATCH .../members/{userId}` and take people off the
roster with `DELETE`, which revokes an unaccepted invitation just as it removes
a member: the row _is_ the relationship. Two invariants are enforced by the
write, not by a check that races:

- **An organization always has at least one admin.** `OrganizationsTable`
  carries an `adminCount`, and a demotion or removal that would take the last
  admin out is a transaction whose condition is `adminCount > 1`. Two admins
  demoting each other at the same moment cannot both pass — DynamoDB evaluates
  the condition on the same item the counter moves on. Withdrawing an invitation
  moves nothing: only _active_ admins are counted.
- **The owner stays.** `ownerId` is what the organization is attributed to and
  nothing hands ownership on yet, so demoting or removing the owner answers
  `409` rather than leaving an organization whose owner has no access to it. The
  roster hides those controls for their row instead of offering a call that
  cannot succeed.

The roster API returns its own shape (`ApiMember`) rather than the stored row: a
pending row is keyed by an email address that exists only as a placeholder for a
`sub` that does not yet exist, so the client is told which kind of row it is
(`pending`, `isInvitationForYou`) instead of being handed an address to treat as
an id. Addresses themselves come back only to admins — the roster is for knowing
who is in the organization, and nobody else can act on an address anyway.

**Emailing the invitation.** Inviting somebody emails them through **SES**: a
one-column HTML part and a plain-text part, with a link to
`/organizations?invitation={orgId}`. The link carries **no token** — being
signed in as the invited address is what accepting means, so the email is a
place to go rather than a secret to present, and the query parameter only says
which offer it was about.

Two things have to be true before that mail arrives, and neither is detectable
from inside the app:

```bash
cd services/api
./scripts/set-mail-sender.sh --show                    # what is configured now
./scripts/set-mail-sender.sh --from=you@example.com    # verify + store a sender
./scripts/set-mail-sender.sh --app-url=https://app.example.com --from=you@example.com
```

1. **A verified sending identity.** The address is stored in SSM
   (`/play/mail/from-address`) and the service will not send at all while it is
   unset. `--from` verifies the identity with SES and stores it; the verification
   email SES sends must be clicked before anything can be sent as it.
2. **Out of the SES sandbox — or a verified recipient.** In the sandbox SES will
   only deliver to _verified_ addresses, so an invitation to an unverified
   address is rejected with `MessageRejected`. The script prints the sandbox
   state and the verified identities, because this is the single thing that most
   often makes "I never got the email" true.

`app-base-url` is where the link points, and it defaults to `localhost:3000` —
set it to the deployed frontend before inviting people who are not on this
machine.

**A failed send is never a failed invite.** The invitation row is written first
and the send is reported, not thrown: the API answers with
`{ delivery: { sent, from, error }, inviteUrl }` either way. The Members page
and the invite dialog read that and say what actually happened — "sent", or the
SDK's own reason plus the link to pass on by hand. `Send invitation again` on a
pending row re-sends it (and may correct the role in the same call), and
`Copy invitation link` is the invite path that does not depend on mail at all.

**Not built yet:** nothing revokes an invitation link, because the link is not a
credential — an offer is claimed by signing in as the address it names, and
withdrawing the invitation is what ends it.

### Spaces (courses)

A **space** is a course an organization publishes: the container its videos will
be grouped and sequenced in. It is created by an admin or editor and readable by
every member of the organization.

| Field                                 | Notes                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `spaceId`                             | ULID, the table key                                                                               |
| `organizationId`                      | the owning organization; a space never exists outside one                                         |
| `title`                               | required, 2–80 characters (whitespace collapsed)                                                  |
| `description`                         | optional, ≤ 500 characters                                                                        |
| `type`                                | `SELF_PACED` or `SCHEDULED`                                                                       |
| `color`                               | optional `#rrggbb` accent                                                                         |
| `startAt`, `dripIntervalDays`         | scheduled spaces only: when it starts, and how many days apart sections unlock (default 7, 1–365) |
| `thumbnailKey`                        | optional cover image key                                                                          |
| `listed`                              | whether the course appears in the marketplace catalog; absent means private                       |
| `createdBy`, `createdAt`, `updatedAt` | provenance                                                                                        |

The two types are the whole of the scheduling model, and they differ in what the
clock is measured _from_:

- **Self-paced** — the course starts when a member enrolls and everything is
  available immediately. Nothing else is stored: a start date here would be a
  second, contradictory source of truth, so the API ignores one if it is sent.
- **Scheduled** — the course starts on a specific date and its sections unlock
  relative to _that_ date rather than to enrollment.

`type` is stored as a string rather than a number so a third type can be added
later without migrating existing rows; only these two exist today, and the form
offers only these two.

A date-only start (`2025-01-15`, what an `<input type="date">` submits) is pinned
to **UTC midnight** on the way in, and formatted back in UTC on the way out. A
scheduled space starts on a _day_, so reading it back in the viewer's timezone
would shift it by a day for anyone west of UTC.

Colour is optional and validated as `#rrggbb`. A space without one is drawn in a
colour derived from its id, so a wall of spaces is still legible and a space keeps
one colour in the list, the sidebar, and its own page. The hash is over the id
rather than the title, because titles get edited.

| Table         | Keys             | Purpose                                                                                                                                                                          |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SpacesTable` | `spaceId` (hash) | title, description, type, colour, schedule, cover key, `listed`; GSIs `OrganizationCreatedIndex` (organizationId + createdAt) and `CatalogCreatedIndex` (catalogKey + createdAt) |

One index per listing: an organization's spaces newest-first, and the
marketplace's catalog newest-first. Filtering by type is a filter over a page the
caller already has, so it does not get a key space of its own.

The catalog index is **sparse**: a listed course carries `catalogKey = LISTED`
beside the flag, and unlisting removes both, so the index holds the published
courses and nothing else and the marketplace's catalog is a query rather than
a scan of every course in the service with a `listed = true` filter on top. A
boolean cannot be a partition key; a constant that only published courses have
can be.

Covers live in the same bucket as video thumbnails, under
`spaces/{spaceId}/cover-{timestamp}.{ext}`. The distribution already serves that
bucket through the same key group, so a cover needed no new infrastructure — and
because the key is timestamped, replacing a cover never needs a cache
invalidation. The previous cover is deleted first, so replaced images do not
accumulate invisibly in the bucket.

What is **not** built yet: deleting a space, and anything that actually enforces a
drip schedule. A scheduled space today records when it starts and how far apart
its sections should unlock — the rules are stored, not yet applied.

### The catalog

| Method   | Path                           | Auth     | What it does                                                                                                         |
| -------- | ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/catalog/courses`             | **none** | A page of listed courses: the course, the organization's name, section/lesson/student counts, and a signed cover URL |
| `GET`    | `/catalog/courses?query=…`     | **none** | Searches those courses instead: title, description or community name, case-insensitive, no `nextToken`               |
| `GET`    | `/catalog/courses/{spaceId}`   | **none** | One listed course and its syllabus: sections, and the titles of the lessons in them                                  |
| `POST`   | `/spaces/{spaceId}/enrollment` | JWT      | Register the caller for a listed course                                                                              |
| `DELETE` | `/spaces/{spaceId}/enrollment` | JWT      | Drop the caller out of a course                                                                                      |

`query` filters what a card shows — the course's title, its description, and the
name of the community it is from — by case-insensitive substring, so `film`
matches "Film Studies" and "Filmmaking" and `flm` matches neither. It is not
fuzzy and there is no index behind it: a search reads up to 200 published
courses and answers without a `nextToken`, because "no results" has to mean the
catalog has none rather than that they are on page two. A catalog big enough
that this stops being true wants a search index, not a larger number.

The two catalog routes deliberately carry **no authorizer**. A catalog that
required an account would be a catalog nobody reads — deciding to register is
what happens before you have one — and nothing they serve is anybody's: it is
what each course says about itself in public. Unlisted is answered `404` rather
than `403`, for the same reason a missing organization is: a stranger must not be
able to learn that a private course id exists.

The counts (sections, lessons, students) are read rather than stored — one
`COUNT` query each, over indexes the course already has — because a counter
maintained by hand across section and lesson writes is a number that eventually
lies about the course on the page whose whole job is to describe it.

Registering writes the same `SpaceMembersTable` row an invitation does, as a
`STUDENT`: it is the one membership nobody was invited to. It is idempotent, and
an invitation already waiting for the caller's address _is_ the registration —
the row is re-keyed from the email to their `sub`, keeping the role it offered.

### Sections and content

A space holds **sections**; a section holds **content**. A section is a heading
with an order, and content is one lesson: a title, the video it plays, its notes,
and the files that go with it.

```
Space ─┬─ Section 1 ─┬─ Content (video + notes + files)
       │             └─ Content
       └─ Section 2 ─── Content
```

| Table               | Keys                                  | Purpose                                                                                                                                           |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SectionsTable`     | `sectionId` (hash)                    | title, description, position, spaceId, organizationId; GSI `SpacePositionIndex` (spaceId + position)                                              |
| `ContentsTable`     | `contentId` (hash)                    | title, type, videoId, notes, position, counters; GSIs `SectionPositionIndex` (sectionId + position) and `SpacePositionIndex` (spaceId + position) |
| `ContentFilesTable` | `contentId` (hash) + `fileId` (range) | name, S3 key, MIME type, size, who attached it                                                                                                    |

**Order is stored, not inferred.** Sections and content each carry a `position`
that the author decides, rather than being read in the order they happened to be
written. Positions are per parent — a content's position orders it inside its
section — and they are sparse, which is what makes a move cheap: swapping two
neighbours writes two positions and renumbers nothing between them. A create
without an explicit position appends, which is one `Query` with `Limit: 1`
against the parent's index rather than a count.

**A course is read whole.** `GET /spaces/{spaceId}/sections` returns the outline:
every section in order, each with the content filed under it. Those are two
reads — the space's sections and the space's content — and the content is grouped
by `sectionId` in the handler, so the page costs the same two reads whether a
course has two sections or twenty. Both reads carry a ceiling (200 sections, 500
pieces of content) and the response reports `truncated` when one is reached
rather than quietly showing part of a course. A section large enough to need
paging has its own endpoint for it.

**Notes are a document, not HTML.** Content stores a TipTap/ProseMirror document
(`{ type: 'doc', … }`) under `notes`, bounded at 100 KB. The frontend renders it
by walking the tree and returning elements, so nothing an author writes is ever
handed to the browser as markup — an unknown node renders its children, and a
link whose scheme is not `http(s)`, `mailto` or `tel` renders as plain text. An
HTML string is rejected at the API boundary for the same reason: there is no path
through this system that stores markup it will later execute.

**Files are attached, not embedded.** An attachment is its own row rather than an
array on the content, so adding or removing one is a single item write that
cannot race with an edit to the notes beside it. The bytes go straight to S3 with
a presigned PUT — `PUT /contents/{contentId}/files` reserves the row and returns
the URL — and the objects live under `contents/{contentId}/{fileId}/{name}`, so
one signed CloudFront policy covers every file of a lesson and deleting a lesson
is one prefix delete. A listing returns each file with a signed URL already in
it; the signature is produced once and reused for the whole listing rather than
signed per file.

**Deletes cascade downwards.** Deleting a section deletes the content under it;
deleting content deletes its attachments and its comments. The children go first
and the parent row last, so a failure part way through leaves something visible
and deletable rather than unreachable rows. Favourites and playlist entries aimed
at deleted content are deliberately left alone: they are a learner's own
pointers, and a pointer whose target is gone is skipped when their list is read.

### Quizzes and question banks

A course can check what it taught. Three records make that work, and the splits
between them are the design:

```
QuestionBank ─── Question ─── Lesson (a VIDEO content)
                    │
                    └── QuizQuestionLink ─── Quiz (a QUIZ content)
                                             │
                                             └── QuizAttempt (somebody sat it)
```

**A question belongs to a bank and is about a lesson.** That is the rule: a
question without a lesson is a question nobody can tell is still true — the lesson
is re-recorded, the words that made the question correct change, and the question
goes on being asked. A **quiz** does not own questions; it *asks* them, one link
row each with a position, so a question written once and read once can be asked
by a quiz in this course, by a retake, and by next term's version of the same
course. A **bank** belongs to the organization rather than to a course, because a
course-shaped bank would mean writing the same question again the moment two
courses shared a lesson's subject.

**A machine's question is a draft.** Anything generated or imported arrives
`NEEDS_VERIFICATION`, and no parameter anywhere creates a verified question: a
person reads it and verifies it (`PUT /questions/{id}/verification`, recording
who and when), or deletes it. Verifying is once, wherever it is done — a question
is shared. Editing what a question *asks*, or the lesson it is about, takes the
verification away.

**Generation is queued, not awaited.** `POST
/banks/{bankId}/questions/generation` writes the run onto the bank, publishes an
EventBridge event (`play.questions` / `Quiz Generation Requested`), and answers
`202` with the bank. `play-<stage>-generate-questions` reads the lesson's
transcript and notes, calls Bedrock's model-agnostic `Converse` API, validates
every question it gets back, and writes them `NEEDS_VERIFICATION` — adding them
to a quiz too when the run was started from one. A REST request cannot be held
open long enough for a model to read a lesson, which is the whole reason for the
event in the middle.

**Import reads the file the author already has**: `.xlsx` (first sheet), `.csv`
(delimiter sniffed) or `.json`, base64 inside a JSON body because API Gateway's
REST integration has no multipart parser. One file is about one lesson — a lesson
*column* would be a column the importer had to guess at, since a lesson title is
not unique. A row that cannot be read is reported with its line number rather
than failing the file.

**A quiz asks about its own course's lessons**, enforced in `addQuestionsToQuiz`
rather than in the picker: a question about another course's lesson is one its
learners cannot answer. Adding one twice is one row, not an error.

**Moving is a place, not an order.** `PUT …/placement { index }` says *where* a
row lands — the server renumbers from what the container currently holds — so a
client that sends a stale view of a list cannot delete a row somebody else added
while the drag was in flight.

**A quiz can be sat, and the answer key never reaches somebody who has not
answered.** `GET /contents/{contentId}/quiz` is authorized as a *read* of the
course — the learner registered for it is in no organization at all — and answers
with questions whose type has nowhere to put the key, so a handler that forgot to
strip it would have to add a field to leak it. Only **verified** questions are
asked, and the rest are counted so the page can say why it looks short. Handing
in (`POST …/quiz/attempts`) is marked on the server and finishes the quiz: the
completion and the course's rewards are written in the same request, exactly as
marking a lesson complete does. Each attempt is a record of a moment — it carries
the prompt, the options, the pick, what was right *then* and the explanation — so
a question edited afterwards neither re-marks it nor leaves a blank where it was.
A question can also be **checked on its own** while the quiz is being sat
(`POST …/quiz/check`), which says whether the answer in hand is right and why:
that is the moment a quiz teaches anything, and it records nothing — an attempt is
one sitting, and a row per look would be a log of keystrokes. The options are
**dealt afresh on every sitting** — a shuffle the API picked would be the same one
on every retake, which is a shuffle somebody can learn — and the page sends the
hand it was dealt back with the sheet, so the attempt records the options in the
order they were answered. The API checks that order is a permutation of the
question's own options before using it, and the marking goes by option id either
way.

A course's own page carries the third view of the same questions — a **Question
banks** tab beside Content — which is every question about *this course's*
lessons, from every bank, grouped by lesson and including the lessons nothing has
been written about yet. It reads through the questions table's
`SpacePositionIndex`, so the tab is one query, and it authorizes as organization
membership: a learner registered for the course is not told what the answers are.

Four tables arrived with this feature and no deploy creates them:
`QuestionsTable`, `QuestionBanksTable`, `QuizQuestionsTable` and
`QuizAttemptsTable` are made by `node infra/scripts/create-quiz-tables.mjs --yes`,
once per stage, and recorded in `infra/config/play-<stage>.json`.
[docs/quizzes.md](docs/quizzes.md) is the full map — the model, the routes, the
import format, taking a quiz, what deleting what takes with it, and what is
deliberately not built yet (no pass mark, no time limit, and no view of anybody
else's results).

### Learner state

Five things a learner does: **favouriting** content, keeping a **learning
playlist**, **commenting**, saving **loops** — named stretches of a lesson's
video, for hearing a piece again — and marking a lesson **done**. The heart, the
comments, the loops and progress are built end to end — the classroom draws them
and the marketplace lists what was hearted at `/favourites`; the learning
playlist is the one with an API and a typed client and no screen over it yet.

| Table               | Keys                                     | Purpose                                                                |
| ------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `FavouritesTable`   | `userId` (hash) + `targetKey` (range)    | a favourite of content, of a comment, or of a loop                     |
| `PlaylistTable`     | `userId` (hash) + `contentId` (range)    | what a learner means to watch; GSI `UserAddedIndex` (userId + addedAt) |
| `CommentsTable`     | `contentId` (hash) + `commentId` (range) | a lesson's discussion, replies included                                |
| `ContentLoopsTable` | `userId` (hash) + `loopKey` (range)      | a learner's named stretches of a lesson's video                        |
| `CompletionsTable`  | `userId` (hash) + `spaceKey` (range)     | what a learner has finished in a course                                |

**Counts live on the thing being counted.** Content carries `favouriteCount` and
`commentCount`, a comment carries `favouriteCount` and `replyCount`, and content
carries `fileCount`. A lesson page shows all of them, and counting them on read
would be a query each.

**A toggle is a conditional write.** Favouriting is a `PutItem` with
`attribute_not_exists(targetKey)`, unfavouriting a `DeleteItem` with
`attribute_exists(targetKey)`; the counter only moves when that write actually
created or removed a row. That is what makes a double tap one favourite and one
increment, and the counters themselves use `ADD`, which is atomic and treats a
missing attribute as zero — so nothing has to be initialized and two learners
acting at once cannot lose each other's increment. The response reports the new
count, computed from the row the handler already read, so the client does not
have to ask again.

**Threads are two levels deep.** A reply records the top-level comment it belongs
to as `parentId`, and — when it answers a reply — which comment it answers as
`replyToId`. Depth is capped here on purpose: it is what the interfaces people
already use do, and it means a lesson's whole discussion is one query with no
recursive assembly. A deleted comment that has replies is emptied
(`deletedAt`, body cleared) rather than removed, so its answers keep their parent;
one without replies simply goes. A discussion is read whole, so `GET` on the
comments returns threads rather than pages, with a ceiling of 500 comments — read
newest-first, so what the ceiling cuts off is the oldest part of the discussion,
never a reply posted a minute ago. Each comment comes back with `favourited` on
it: the caller's own favourites of that kind are read alongside the thread, so
the hearts are drawn from the one request that read the discussion.

**A loop is addressed through its owner.** Its key is `userId` + `{contentId}#{loopId}`,
so "mine" is one `begins_with` query, and a lookup is built from the caller's own
id — which makes "anyone may read a lesson, but only you may change your loops on
it" a property of the key rather than a check somebody has to remember.

**Loops are shared with the course**, so the lesson needs the other direction as
well: a `ContentCreatedIndex` on the same table lists every loop on a lesson,
whoever made it. That index is the one place where a table needs granting twice
— IAM treats an index as its own resource, so `dynamodb:Query` on a table is not
permission to query its indexes, and a table granted without them lists fine and
fails on every lookup. Every indexed table here therefore grants both. That is also what makes liking one mean something — a like on
something nobody else can see is a note to yourself. Any member may like any
loop, its maker included, and the count lives on the loop with the same
conditional-write rule everything else here uses: the row is only written when a
like row was actually created, so a double tap is one like.

**Sharing a loop is a link.** `?loop={loopId}` opens the lesson with that passage
selected and playing; nothing about it is remembered on the server, because a
link that carries its own range needs nothing remembered. Copying uses the
clipboard, and falls back to asking — a refused clipboard is not a reason to have
no link at all. Boundaries are milliseconds rather than transcript line numbers,
because milliseconds are what a player seeks by and a loop should survive the
transcript being re-cut. Its colour is derived from its id rather than stored, so
a list is told apart at a glance without anyone choosing.

**A loop is made by marking its two ends.** Press _New loop_ where it starts,
press _Set end_ where it ends, and it is saved and named in place — the way every
A–B repeat has ever been made, and the only flow that works while the video is
playing, which is when you notice the piece you want again. Playing one repeats
it: a frame loop watches the playhead and puts it back at the start when it
leaves the end, and it holds even when you scrub _out_ of the loop, because a
loop you can fall out of by touching the scrubber is one that stops when you are
least sure it will.

**Progress is a record, not an assessment.** Marking a lesson done stores the
moment it was finished and nothing else — no score, no check by anyone, and no
one else's business, which is why it is keyed by the learner and reachable only
through them, and why the button that sets it takes it back just as easily.
`{spaceId}#{contentId}` is the sort key, so a course's progress is one
`begins_with` query — which is what a progress bar over a whole course will read,
and what the lesson page's own lookup is built from.

**Comments need reading access; everything else editorial does not.** Any member
of the organization can comment, favourite, and play-list. Only the author can
edit their own comment — an admin or editor can take one down, but not put words
in someone's mouth — and the comment pins the author's name as it was when they
wrote it.

### Videos belong to organizations

Every video is created inside an organization: `organizationId` is **required**
on `POST /videos`, and the caller must hold the admin or editor role there.

**Reading one is wider than listing them**, and the difference is the whole of
the marketplace's playback:

| Question                                                              | Who may ask it                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /videos/{videoId}` (and its stream, subtitles, thumbnail, audio) | a member of the owning organization, **or** a member of a course whose lessons play that video |
| `GET /videos?organizationId=…` (the library)                          | a member of that organization only                                                             |
| `POST`/`PATCH`/`DELETE /videos/{videoId}`, regenerate, retry          | admin or editor of the owning organization                                                     |

A learner registers for a course, not for the organization that wrote it — they
may never have heard of that organization — so authorizing their playback
against the organization alone refuses the one thing the course is for. The
second way in is deliberately narrow: it is a _course_ membership, and only for a
video that course actually teaches with, so a learner in one course has no claim
on the rest of the organization's video library (and still cannot list it).

That question — which courses teach with this video — is one query, over the
`VideoSpaceIndex` on `ContentsTable` (`videoId` + `spaceId`, keys only, sparse
because only a lesson that plays a video carries one):

| Index                  | Keys                     | Answers                               |
| ---------------------- | ------------------------ | ------------------------------------- |
| `SectionPositionIndex` | `sectionId` + `position` | a section's lessons, in order         |
| `SpacePositionIndex`   | `spaceId` + `position`   | a whole course's outline in one query |
| `VideoSpaceIndex`      | `videoId` + `spaceId`    | which courses play this video         |

A video carries **both** its owner and its organization. `ownerId` records who
uploaded it; `organizationId` decides who can see it. That is why the videos
table has two parallel index families:

| Index                      | Keys                           | Answers                                  |
| -------------------------- | ------------------------------ | ---------------------------------------- |
| `OwnerCreatedIndex`        | `ownerId` + `createdAt`        | "everything I uploaded"                  |
| `OwnerStatusIndex`         | `ownerId` + `status`           | my uploads in one state                  |
| `OrganizationCreatedIndex` | `organizationId` + `createdAt` | the organization's library, newest first |
| `OrganizationStatusIndex`  | `organizationId` + `status`    | the organization's library in one state  |

An organization's library is therefore a single `Query`, not a scan or an
in-memory filter, and `listVideosByIndex` in `src/lib/dynamodb.ts` implements
both key spaces once.

> **Migrating an existing table: add the two indexes in two deploys.**
> DynamoDB allows only **one global secondary index to be created or deleted per
> `UpdateTable` call**, and CloudFormation sends the whole diff in one call. A
> stack whose table predates these indexes therefore fails with:
>
> ```
> UPDATE_FAILED: VideosTable (AWS::DynamoDB::Table)
> Cannot perform more than one GSI creation or deletion in a single update
> ```
>
> The stack rolls back cleanly and the table is left untouched (no data loss, no
> half-created index), so the fix is to split it:
>
> 1. Declare only `OrganizationCreatedIndex` and deploy.
> 2. Add `OrganizationStatusIndex` back and deploy again.
>
> This is history rather than instructions: it happened while the tables were
> still managed. They are **imported** now, so a new index on one of them is an
> `aws dynamodb update-table` call — and a second one waits for the first to
> finish backfilling, for the same reason.
>
> Between the two deploys a status-filtered organization listing (`GET
/videos?organizationId=…&status=…`) fails, because the code asks for an index
> that does not exist yet; the unfiltered listing works. A _fresh_ stack is
> unaffected — the limit applies to updates, not to creation, so a new stage
> creates all four indexes in one go.
>
> The first index also has to finish backfilling before the second can be added,
> so wait for it and then deploy:
>
> ```bash
> while [ "$(aws dynamodb describe-table --table-name "$VIDEOS_TABLE" \
>   --region us-east-1 \
>   --query "Table.GlobalSecondaryIndexes[?IndexName=='OrganizationCreatedIndex'].IndexStatus" \
>   --output text)" != "ACTIVE" ]; do sleep 20; done
>
> npm run deploy
> ```

#### Who can touch a video

`src/lib/access.ts` is the single place this policy lives:

|                                   | Read | Write (edit, delete, re-encode, retitle) | Manage members and roles |
| --------------------------------- | ---- | ---------------------------------------- | ------------------------ |
| Organization admin                | yes  | yes                                      | yes                      |
| Organization editor               | yes  | yes                                      | no                       |
| Organization viewer               | yes  | no                                       | no                       |
| Someone invited, not yet accepted | no   | no                                       | no                       |
| The uploader                      | yes  | yes                                      | no                       |
| Anyone else                       | no   | no                                       | no                       |

Two deliberate choices:

- **The uploader always keeps access, even as a viewer.** Without it, the backfill
  below could lock someone out of videos they uploaded themselves.
- **A missing organization and a non-membership both answer `403`**, so the API
  never reveals which organization ids exist. An unaccepted invitation answers
  the same way, because it is not a membership (see [Members](#members)).

Before this, all 14 video handlers compared `video.ownerId` against the caller
inline and each repeated the same three lines. They now call
`requireVideoAccess(videoId, userId, 'read' | 'write')`, so the policy can be
changed in one file instead of fourteen.

#### IDs

Organizations and videos are identified by **ULIDs** (`01M3DQK2P9FJQZE83FNDDDG03D`)
rather than UUIDs: shorter, URL-friendly, and time-ordered by prefix. IDs are
opaque — nothing parses them — which matters because videos created before the
switch still carry UUIDs. One place used to assume the shape and had to change:
Transcribe job names are `play-{videoId}-{timestamp}`, and subtitle completion
extracted the id with a UUID regex. It now parses between the `play-` prefix and
the trailing timestamp, so both id shapes resolve
(`src/functions/processing/subtitle-generation-complete.ts`).

#### Backfilling videos that predate organizations

Videos created earlier have no `organizationId` and belong only to their
uploader. `scripts/backfill-video-organizations.js` assigns them to an
organization:

```bash
cd services/api
node scripts/backfill-video-organizations.js --organization-id=<orgId> --dry-run
node scripts/backfill-video-organizations.js --organization-id=<orgId>
```

It resolves the physical table names from `infra/config/play-<stage>.json` — the
same file the CDK app imports the tables by — verifies the
organization exists, reports how many videos it will reassign, and warns about
video owners who are not members of that organization — they keep access to
their own uploads, but will not see the rest of the organization's library until
they are added as members. Re-running it is safe: videos that already have an
organization are skipped, and the update carries a
`attribute_not_exists(organizationId)` condition so it cannot overwrite an
assignment made after the scan.

> The outputs it reads (`VideosTableName`, `OrganizationsTableName`,
> `OrgMembersTableName`) are new — redeploy before running it, or pass
> `--videos-table=` / `--organizations-table=` / `--members-table=` explicitly.
> Note that `describe-stack-resources` is _not_ usable for this: it silently
> truncates at 100 resources on this stack and returns no `NextToken`, so the
> DynamoDB tables never appear in it.

**Not built yet:** enrollment, the drip unlocking a scheduled space describes,
and the screen over the learning playlist — favouriting, commenting, loops and
progress are built end to end, and the playlist has a complete API and a typed
client but nothing in the app calls it yet. Members can be invited, given a role,
re-sent, and removed, and the invitation is emailed through SES — but that needs
a verified sending identity and an account out of the SES sandbox, or the mail is
delivered nowhere (see [Members](#members)).

## Security notes / best practices

- S3 bucket is fully private: block all public access, no ACLs, SSE-S3.
- CloudFront OAC is the only principal allowed to read from S3 (via the bucket
  policy `AWS:SourceArn` condition).
- Streaming content is protected with CloudFront **signed URLs** using a
  path-scoped custom policy. The backend signs a policy covering
  `processed/{videoId}/hls/*` (RSA-SHA1 over the policy JSON), so the same
  query string authorizes every HLS segment; the frontend appends it to each
  request via hls.js `xhrSetup`.
- Uploads go directly to S3 via a short-lived presigned URL (Lambda is never in
  the data path for large files).
- CORS is enabled on both API Gateway and the S3 bucket for the upload flow.
- Secrets are read from SSM Parameter Store at deploy time and never live in the
  repo. Note that `${ssm:...}` is _resolved into_ the template, so the CloudFront
  private key and the Google client secret are both visible to anyone who can
  read the CloudFormation stack. For tighter handling, store the Google secret
  under a path that only the deploying role can read, or use
  `{{resolve:ssm-secure:...}}` (which resolves at deploy time but cannot fall
  back to a default, so it also makes Google credentials mandatory).
- For production: restrict the S3/API CORS `AllowedOrigins`, attach a custom
  domain + ACM cert to CloudFront, enable WAF, and use `PriceClass_All`.

## Local typechecking

Every workspace, from the repository root:

```bash
npm run typecheck          # all of them: both apps, the packages, the backend
npm run typecheck --workspace play-marketplace   # just one
```

The packages are source rather than builds, so an app's typecheck covers the
shared code it draws on: a change to a shared component is checked by the apps
that use it, not only by the package it lives in.
