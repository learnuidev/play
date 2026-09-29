# Working in this repository

One npm workspace, five kinds of package. This is the map and the rules that keep
it from turning back into two apps with copies of each other's code.

```
play/
├── apps/
│   ├── studio/           Play Studio — the creator's app (Next.js, port 3000)
│   ├── marketplace/      Play Marketplace — the learner's app (Next.js, port 3001)
│   └── demo/             Play Demo — somebody else's app (Next.js, port 4000)
├── packages/
│   ├── types/            @play/types     — the shapes the API and both apps agree on
│   ├── api/              @play/api       — the API client + React Query hooks
│   ├── auth/             @play/auth      — Cognito wiring, the sign-in screen, the gate
│   ├── ui/               @play/ui        — design primitives
│   └── learning/         @play/learning  — the classroom, the player, course cards
├── services/
│   └── api/              play-backend    — the handlers (TypeScript)
├── infra/                play-infra      — the AWS CDK app that deploys them
└── scripts/
    └── get-env.mjs       reads the stack outputs into an app's .env.local
```

## Commands

```bash
npm install                       # once, at the root: one lockfile, hoisted node_modules

npm run dev:studio                # http://localhost:3000
npm run dev:marketplace           # http://localhost:3001
npm run dev:demo                  # http://localhost:4000

npm run build                     # both apps
npm run build:studio              # one app
npm run typecheck                 # every workspace that has a typecheck script
npm run get-env -- --profile=…    # stack outputs into both apps' .env.local

npm run diff                      # what an infrastructure change would do
npm run deploy                    # cdk deploy — every backend stack
npm run deploy:api                # just the API, which is the one that changes
```

`npm run <script> --workspace <name>` runs a script in one workspace;
`--workspaces --if-present` runs it in all of them.

The two apps are deployed to Vercel as two projects built from this one
repository; the backend keeps deploying from here to AWS, as above. That setup,
and the configuration on the other side of it, is [deploy.md](deploy.md).

### The third app is not part of the product

`apps/demo` is a **client**, not a surface: a third-party app that signs people
in with Play over OAuth and reads `/v1` with the token it is given. It exists so
that the public API and the OAuth flow have a worked example that is not one of
Play's own apps — the two things a reader cannot check from inside the product.

Three consequences worth knowing before editing it:

- **It may not import `@play/auth` or `@play/api`.** Those are Play's own
  signed-in client; the moment this app used either, it would stop being a
  demonstration of what somebody outside can build. Its only dependencies are
  `@play/types`, `@play/ui` and `@play/learning` — the shapes, the primitives,
  and the classroom pieces that are genuinely shared.
- **It is not deployed and has no backend.** It runs on localhost, holds its
  tokens in the browser, and registers as a *public* OAuth client precisely
  because it has nowhere to keep a secret.
- **It needs one manual step** — registering its client id in the studio — which
  is why `apps/demo/README.md` exists and why the app renders those instructions
  itself when the variable is unset.

Its README is the document for it; this one only needs to know that it is a leaf.
Do not add shared code to `packages/*` for its sake alone.

## Packages ship source

`@play/*` packages have no build step and no `dist/`: their `package.json` points
at `src/index.ts`, and each app compiles them as part of itself through Next's
`transpilePackages` (plus `experimental.externalDir`, because they live outside
the app's directory).

That is a deliberate trade. It means one TypeScript program across an app and its
packages, so **a change to a shared component is a change the app's typecheck
sees**; and it means no stale build output to forget to regenerate. The cost is
that nothing can consume these packages except a bundler that transpiles
TypeScript — which, here, is both apps and nothing else.

Each package:

- declares its own dependencies (they are hoisted to the root `node_modules`);
- has its own `tsconfig.json` extending `tsconfig.base.json`, with the aliases
  below;
- has a `typecheck` script, so `npm run typecheck` at the root covers it;
- has an `src/index.ts` barrel. `@play/ui`, `@play/api` and `@play/auth`
  re-export every module beside them, one line each — they hold nothing heavier
  than a dialog or a query hook. `@play/learning` does not: it curates its
  surface (the classroom, the routes, the course card), because `export *` there
  put ~130 kB of player and TipTap into the bundle of any page that only wanted
  the classroom. Everything else in it is imported by path. Add to that barrel
  deliberately, and measure a lesson page when you do.

## Aliases

| Alias | Resolves to | Who uses it |
| --- | --- | --- |
| `@/*` | the app's own `src` | an app's own code, only |
| `@play/types` | `packages/types/src/index.ts` | both apps and every package |
| `@play/ui`, `@play/api`, `@play/auth`, `@play/learning` | the package's `src/index.ts` | an app importing a package |
| `@ui/*`, `@api/*`, `@auth/*`, `@learning/*` | the package's `src/*` | files *inside* the packages |

`@/*` is per-app and never crosses a boundary: a file in a package that imported
`@/lib/api` would resolve to the app's `src/lib/api`, which is exactly the bug
this layout exists to prevent. Anything shared is imported by its package name.

The aliases are declared in each app's and each package's `tsconfig.json`, and
Next resolves them from there. `@videojs/react` is pinned to an exact beta in
`packages/learning`: a caret on a prerelease floats to `rc` releases, and `rc.4`
dropped the player API the classroom uses.

## Where things live

| What | Where |
| --- | --- |
| A screen only one app has | that app's `src/app` and `src/components` |
| A screen both apps have, with different URLs or data | `@play/learning`, with the differences as props |
| A screen both apps have and neither varies — the sign-in | `@play/auth` |
| A quiz's questions, and the routes that write them | `services/api/src/lib/questions.ts` + `functions/questions/*` — see [quizzes.md](quizzes.md) |
| A credential somebody calls the API with, and the screens for it | `services/api` + the studio's `/api-keys` and `/oauth/*` |
| A request, its cache key and its invalidation | `@play/api/modules/*/*.queries.ts` |
| Anything a page renders that is not specific to a screen | `@play/ui` |
| A shape the API serializes | `@play/types` — and the same shape in `services/api/src/types` |

The two type files are deliberately separate: the API's types describe rows, the
shared package describes what crosses the wire. When a field is added to an API
response, it is added in both.

## Shared screens: the classroom

The lesson experience is the one screen both apps render, and it is the pattern
to copy for the next one.

A lesson is *read* rather than browsed, so both apps strip their frame for it —
the studio's `AppShell` drops the rail, the community panel and the tab bar; the
marketplace's `SiteChrome` drops the top bar and the `max-w-6xl` reading measure
and hands the classroom the window. Each app decides that in one place, from its
own `lessonRoute(pathname)`, so the frame and the page cannot disagree about
which pages are lessons.

The studio makes one more exception, for the same reason: `OrgTabs` also stays
out of a course's own page (`spaceRoute`), which brings a header and a strip of
tabs of its own — an organization bar above those would be a second answer to
"where am I", and would put the word *Members* on screen twice. The rule lives in
`lib/routes.ts` beside `lessonRoute`, not in the bar.

`<Classroom spaceId contentId />` takes what it is showing, whether the reader may
edit it (`canEdit`), the organization to pick videos from (`orgId`, studio only)
and a `LearningRoutes` object that says where a course and a lesson live. It puts
that object in a context, so the outline and the course list inside it draw their
links without being told again:

```tsx
// apps/studio
const routes = useMemo(() => studioLearningRoutes(orgId), [orgId]);
<Classroom spaceId={spaceId} contentId={contentId} orgId={orgId} canEdit routes={routes} />

// apps/marketplace
<Classroom spaceId={spaceId} contentId={contentId} routes={marketplaceLearningRoutes} />
```

What the shared component must **not** do is assume a route, read an app's own
`useParams`, or fetch something only one app's backend is allowed to serve.

## Instructors, and the person behind them

A course is credited to people, and until recently the product could not say who:
the `INSTRUCTOR` role existed on a course's roster — "runs it, and is named as the
one who does" — and was named nowhere. There was also nowhere for a person to say
what they were called: the only name in the system was an identity provider's
`name` claim, which a password account does not have and nobody can edit.

Two records fix both, and they are deliberately separate:

- **`ProfilesTable`** (`services/api`, keyed by the Cognito `sub`) is the person:
  a name, a photo, a sentence, five links. It is read by `GET /me/profile` and
  written by `PUT /me/profile` and `PUT /me/profile/photo` — all under `/me`,
  with no id in the path, because the caller's own token is the only id there is.
  The first read is what creates the row, named from the claims the API can see;
  from then on the person renames themselves. Nothing in it is a permission.
- **The roster role** stays where it was. Being an instructor *is* the
  assignment: the studio's Instructors panel (on a course's Overview tab) is a
  view of the roster's `INSTRUCTOR` rows, and "Add instructor" promotes a member
  rather than writing to a second list that would have to keep in step with the
  first.

The two meet in `services/api/src/lib/instructors.ts`, which is the only place
that answers "who teaches this, and what do they teach":

| Endpoint | Who may read it | Why |
| --- | --- | --- |
| `GET /spaces/{spaceId}/instructors` | anyone who can read the course | the studio's panel, and the marketplace's member view of an unlisted course |
| `GET /catalog/courses/{spaceId}` | anybody — no authorizer | the course page, which carries `instructors` beside its syllabus |
| `GET /catalog/instructors/{userId}` | anybody — no authorizer | `/instructors/[id]`: the profile, plus every listed course they teach |

Both public routes answer 404 rather than 403 for something that is not listed,
which is the catalog's own rule: a stranger is not told which ids exist in
private. What crosses that boundary is the *public* half of a profile — a name, a
face, a sentence, links — never an address, and an instructor with no profile is
still credited, named from what the API holds about them, because a course page
that credits nobody credits nothing.

Two shared pieces keep the two apps honest about it: `PublicInstructor` in
`@play/types` is the wire shape both draw, and `PersonAvatar` in `@play/ui` is
the circle they draw it in — the photo when there is one, and a person silhouette
rather than initials when there is not, because initials are also what a missing
photo looks like.

A roster row carries `name` and `photoUrl` too, read in one batch with the page
it belongs to. That is what makes the studio's Members tab readable and what the
Instructors panel picks from: choosing somebody to teach a course means choosing
them by name.

## Styling

Tailwind v4 scans the app's directory by default, so each app's `globals.css`
carries an explicit `@source` for the packages:

```css
@source "../../../../packages/ui/src";
@source "../../../../packages/learning/src";
@source "../../../../packages/auth/src";
```

Without it, the classes only the packages use are never generated and the shared
components render unstyled — which looks like a broken component rather than a
missing build setting. `packages/auth` is on the list for the sign-in screen's
own markup (the mark and its headline are Tailwind; the form under them is
Amplify's and is styled in `packages/auth/src/sign-in.css` instead).

All three apps import the same `globals.css` copy (the theme tokens and variants
are identical); if the design changes, it changes in all of them, and the
primitives it feeds live in one place. The demo's copy lists two `@source` lines
rather than three, because `@play/auth` is not on its list — nothing there signs
in to Play.

### The vocabulary

Both apps are built to read like one product, and the shared vocabulary is worth
keeping to when adding a screen:

- **Sentence case, never small capitals.** A section heading is a short sentence
  in the same voice as the page title (`text-base font-semibold tracking-tight`),
  not an uppercase tracked label. A wall of `UPPERCASE MICRO-LABELS` reads as a
  form to fill in.
- **The type scale, never arbitrary sizes.** `text-sm`, `text-xs`, `text-2xl` —
  no `text-[13px]`. Sizes outside the scale drift apart the moment two people
  touch the same screen.
- **Large radii and hairline edges.** Panels are `rounded-3xl` with
  `border-border/60`; the canvas behind them is `bg-muted/40`. A card is a frame
  around the page rather than a box drawn around every concern.
- **Tabs are a segmented control**, not underlined links: a `rounded-full` track
  (`bg-muted/70`) with the active item lifted out (`bg-background shadow-sm`).
  The studio's section bar and a course's own tabs are the same control.
- **Translucent bars.** A sticky header is `bg-background/70 backdrop-blur-xl`
  with a `border-border/40` hairline, and is 12 units tall — the page under it is
  the point.
- **Space over lines.** Prefer `py-8`/`py-10` and `gap-6`/`gap-8` between blocks
  to another divider.
- **A pill for the one decision on a screen** — "Complete lesson", "Sign in" —
  and ordinary rounded buttons for everything else.
- **Empty states are composed, not coloured**: a muted icon circle, a line in the
  heading's voice, a sentence of explanation, and the action (`EmptyState`).
- **The marketplace's front page speaks in a marketing register, and the studio's
  now does too.** Large type, wide margins, one accent, and `Reveal` (in
  `@play/ui`, since two pages draw with it) for blocks that arrive as they are
  scrolled to — where the app screens state what is on them, a front page makes a
  claim and then shows the evidence. The marketplace's reviews are written for
  its page rather than collected, so replacing them with real ones is a copy
  change and never a wiring one; the studio's front page has none, because a
  picture of the tool is worth more than a stranger's sentence about it.
- **A front page is not a screen, and it does not live with them.** A claim made
  to somebody who has never heard of the product is a different job from a page
  in the app, which is why the studio's `/` says what the studio is for and the
  community you actually belong to is at `/home`.

The primitives in `@play/ui` are shared and stay deliberately plain: the
vocabulary above is applied at the composition layer (the shell, the page card,
the page itself) so the marketplace and the studio can move together without one
of them restyling the other's buttons.

## Authentication

One Cognito user pool for both apps, so an author in the studio and a learner in
the marketplace are the same account. `@play/auth` is where that lives:

- `AppProviders` — theme, query cache, tooltips, Amplify session, toasts.
  **No gate**: neither app's front page needs an account, and a provider stack
  that insists on one cannot render a landing page at all.
- `AuthGate` — the sign-in wall, for everything that is only for signed-in
  people. It goes in a *layout*, so a section decides once who may see it: the
  studio wraps `/o/[orgId]`, `/spaces`, `/invites`, `/organizations`, `/api-keys`,
  `/oauth/apps`, `/oauth/connections` and `/home`, and the marketplace wraps the
  pages that need an account and sends anonymous readers to `/sign-in?next=…`.
  The one signed-in page that is *not* behind it is `/oauth/authorize`: a consent
  screen somebody reaches while signed out has to be able to send them to sign in
  and come back to the same request, so it handles that itself rather than
  rendering a wall over a URL an app is waiting on.
- `SignIn` — the sign-in screen itself, and the *only* place `socialProviders` is
  passed. A page that renders Amplify's `Authenticator` directly would silently
  offer passwords only, however the deployment is configured.
- `SignInScreen` — what `SignIn` renders: Amplify's flows inside a frame this
  repository draws. `packages/auth/src/sign-in.css` re-points Amplify's design
  tokens at the app's, so the same screen is the studio's in the studio and the
  marketplace's in the marketplace. It has one contract with the app it renders
  in: the screen is a windowful and the card centers in it, so an app that keeps a
  bar of its own takes that bar *out of the flow* on the sign-in route and pins it
  over the top instead of letting it take a slice of the window — which is what
  both apps' sign-in pages do.
- `useIsSignedIn` / `useAuthStatus` — for pages that ask the API who the caller
  is, because "the courses I am in" is a 401 when nobody is signed in, not an
  empty list. The status has three states rather than two so a page can tell
  "nobody" apart from "not yet", which is what stops a signed-in reader being
  told to sign in for the length of one session restore.

**What is public.** In the marketplace: `/`, `/discover`, a course page, an
instructor's page and a lesson. In the studio: `/` (the front page), `/docs` (the
API reference) and `/sign-in`; everything behind a gate is reached from them. A
public page must not call an endpoint that needs a session — `/docs` is the
worked example, where the playground offers a pasted key to a reader with no
account and a sign-in link instead of the key-minting button, and waits for
`useAuthStatus` to settle before deciding which.

Redirect URLs are derived from `window.location.origin`, so the studio gets
`localhost:3000/auth/callback` and the marketplace `localhost:3001/auth/callback`
with no per-app configuration. Both must be registered on the user pool, and the
list is the one piece of auth that changes with *where* the apps are served
rather than with who signs in. `services/api/scripts/set-auth-urls.mjs` writes it,
straight to Cognito: the pool is **imported** by `infra`, so no deploy applies it,
and the script reads the app client before writing it because Cognito's update
calls reset every attribute they are not given. `infra/config/play-<stage>.json`
holds the same list, as the record of what a fresh pool would be built with.

Signing in with Google leaves the page entirely, so `?next=` does not survive it:
`rememberAfterSignIn` leaves a note in session storage and `OAuthCallback` reads
it on the way back. Anything routed through it is validated by `internalPath` —
`next` is attacker-supplied, and a sign-in page that forwards to a full URL is a
phishing link wearing the app's name.

## The backend

Two workspaces, split where a change matters.

- **`services/api`** is the backend's code: 134 handlers, their libraries, and the
  types they share with the apps. It holds no infrastructure, has no deploy
  script, and has one command worth running — `npm run typecheck --workspace
  play-backend`.
- **`infra`** is the AWS CDK app that deploys them: the API, the tables, the media
  and the auth. [`infra/README.md`](../infra/README.md) is its map, and
  [migration.md](migration.md) says where it came from.

```bash
export AWS_PROFILE="$(. scripts/api-config.env && printf %s "$API_AWS_PROFILE")"

npm run diff  --workspace play-infra         # what would change, before it does
npm run deploy --workspace play-infra        # every stack
npm run deploy:api --workspace play-infra    # just the API
npm run synth --workspace play-infra         # local, no credentials needed
```

**The infrastructure that holds data is imported rather than managed.** The 23
tables, the videos bucket, the CloudFront distribution and the Cognito user pool
all exist already, and the CDK app references them by name with `fromTableName`,
`fromBucketName`, `fromDistributionAttributes` and `fromUserPoolId`. An imported
resource is unmanaged: a deploy will not change its properties and will not
delete it — and will not notice if one disappears. That is what makes `cdk
deploy` safe here, and it is the reason a few operations are API calls rather
than deploys.

### A new route is two things

A handler under `services/api/src/functions/**`, and an entry in
`infra/src/generated/service.ts` — its entry point, its timeout, and its routes
with path, method and whether they are authorized. Then:

```bash
npm run synth --workspace play-infra
```

Leaving the authorizer off is how the two public catalog routes are public, and
the `/v1` routes too — they authenticate themselves, for the reason below. It
also decides which nested stack a route lands in, because the group is picked
from its first path segment:

| Group | Path roots | What a change to it re-plans |
| --- | --- | --- |
| `Content` | `videos`, `sections`, `contents` | 279 resources |
| `Courses` | `spaces`, `cohorts`, `rewards`, `catalog` | 209 |
| `People` | `organizations`, `me` | 172 |
| `PublicApi` | `v1`, `oauth` | 191 |

The rule the groups have to obey is that **a path's first segment belongs to
exactly one of them**, and `synth` refuses if a root is unclaimed or claimed
twice. It is not decoration: each stack builds its own slice of the gateway's
resource tree, so two stacks creating `me` is two resources with the same parent
and path part — which API Gateway accepts silently and then serves whichever it
feels like. `infra/src/stacks/api-groups.ts` is where the partition and the
reasoning live.

This is also the answer to what the Serverless service could not do. It was one
stack of 500 resources with a plugin that moved the overflow into nested stacks
*by logical id*, re-deciding the partition on every deploy — which is why
renaming a function could leave it holding two nested stacks for one function,
501 resources, and a template that does not deploy. The partition is written
down now, and nothing moves because a name changed.

### The imported resources are changed by hand, not by a deploy

Anything belonging to an imported resource is outside CloudFormation's reach, so
each one has a script:

| Task | Command |
| --- | --- |
| A callback URL, or a new deployed origin | `node services/api/scripts/set-auth-urls.mjs` |
| Google sign-in enabled or rotated | `services/api/scripts/set-google-oauth.sh` |
| The pool's pre sign-up trigger | `node infra/scripts/adopt-cognito.mjs` |
| Rotating the CloudFront signing key | `services/api/scripts/generate-cloudfront-keypair.sh`, which ends with the two commands that apply it |
| Marking the old stack's stateful resources `Retain` | `node infra/scripts/retain-legacy-resources.mjs` — must run first |
| Removing the old Serverless stack | `infra/scripts/teardown-legacy-stack.sh` |
| Handing the bucket's S3 notification over | `node infra/scripts/handover-s3-notifications.mjs` — once, before the first deploy |

The first three read the resource before writing it. Cognito's update calls are
not patches: every attribute they are not given is set back to its default, so a
callback-URL change that sent only the URLs would quietly drop the client's auth
flows and identity providers — a sign-in failure that looks nothing like a
misconfigured URL.

### The provider environment is a budget

Lambda caps a function's environment at **4 KB**, and this service shares one
`provider.environment` across a hundred functions — so that block is a single
budget, spent collectively, and it was at 3.9 KB.

The CloudFront signing key was 2.3 KB of it. It is now read from SSM Parameter
Store on first use and cached for the container's life (`lib/cloudfront-key`),
which took the environment back to about 1.9 KB and stopped a private key being
readable in the console from every function that would never sign anything.

So: **a new environment variable is a change to every function's budget**, and a
large or secret value belongs in Parameter Store with its *name* in the
environment instead. Anything that reads one should cache the promise rather
than the value, so a cold-start burst makes one call rather than one per
invocation.

## The public API: keys, and OAuth apps

Everything in this service used to be called by one of our own two apps, with a
Cognito token behind it. `/v1` is the other kind of caller, and there are two of
them:

- an **API key** in an `x-api-key` header — a credential a person makes for a
  script, which acts as them and reaches a fixed slice chosen once at creation;
- an **OAuth access token** as `Authorization: Bearer …` — a credential minted
  because a person authorized *somebody else's app* on a consent screen, which
  acts as them and reaches exactly the scopes they agreed to.

Both are resolved by one function into one `ApiCaller`, because every `/v1`
handler asks the same two questions — who is this, and what may they reach — and
a route that took only one of the two credentials would be a route half the
product cannot use.

| What | Where |
| --- | --- |
| The key's row, its hash, and the lookup by secret | `services/api/src/lib/api-keys.ts` |
| The scope catalogue, and the one place a route's requirement is named | `services/api/src/lib/oauth-scopes.ts` |
| Apps, client secrets, client authentication, redirect URIs | `services/api/src/lib/oauth-apps.ts` |
| Authorization requests: what a consent screen is being asked for | `services/api/src/lib/oauth-authorize.ts` |
| Grants — one person's authorization of one app | `services/api/src/lib/oauth-grants.ts` |
| Codes, access tokens, refresh tokens | `services/api/src/lib/oauth-tokens.ts` |
| The OAuth error dialect, client credentials, form bodies | `services/api/src/lib/oauth-http.ts` |
| The header-to-identity step, for either credential | `services/api/src/lib/api-caller.ts` |
| The public surface itself | `services/api/src/functions/public/*` |
| Apps, consent, tokens and revocation | `services/api/src/functions/oauth/*` |
| Making, listing and revoking keys | `services/api/src/functions/api-keys/*` |
| The screens that issue and manage them | `apps/studio/src/app/api-keys`, `apps/studio/src/app/oauth/{apps,authorize,connections}` |
| The reference | `apps/studio/src/app/docs`, described by `apps/studio/src/lib/api-reference.ts` |

### What is true of both credentials

- **No credential is stored, only its hash.** A key's secret, a client secret, an
  authorization code and an access token are all stored as hex SHA-256 and exist
  in the clear exactly once: in the response that created them. Nothing can read
  one back, which is why "copy it now" is the shape of those dialogs rather than a
  nicety.
- **Nothing is cached in front of the check** (`resultTtlInSeconds: 0`).
  Revocation — of a key, or of an app somebody disconnected — takes effect on the
  next request. The price is one DynamoDB read per call, which is what identifying
  a caller costs everywhere else here.
- **A refusing credential is a 401 in this API's own shape.** Because the
  credential is resolved in the handler rather than by an authorizer, an absent
  or unknown one is `{"error":{"code":401,"message":"Unauthorized"}}` — the same
  envelope as every other error here, which is what an integration can read. An
  earlier design answered 403 from a Deny policy; the shape is now consistent
  instead of split between ours and API Gateway's.
- **`/v1` is small and deliberately curated.** Adding to it is a decision, not a
  route. Most of it reads; the four writes are listed below, under the scopes
  they cost.
- **The docs page is data.** A changed response is one object in
  `lib/api-reference.ts`, and the page, the examples and the cURL commands all
  come from it.

### `/v1` authenticates in the handler, not at the gateway

Two credentials reach the public API and they arrive in two different headers: an
API key in `x-api-key`, an OAuth access token as `Authorization: Bearer …`. **An
API Gateway authorizer cannot accept either of two headers**, and it is worth
knowing exactly why, because the naive configuration looks like it works and
returns 401 for every real caller.

Every mapping expression an authorizer is given as an `identitySource` is
validated on every request: all of them must be present, non-null and non-empty,
or API Gateway answers 401 itself without invoking the function. The API
reference is unambiguous that this happens always — only the *property* is
optional when caching is off:

> These parameters will be used to derive the authorization caching key and to
> perform runtime validation of the REQUEST authorizer by verifying all of the
> identity-related request parameters are present, not null and non-empty. Only
> when this is true does the authorizer invoke the authorizer Lambda function,
> otherwise, it returns a 401 Unauthorized response without calling the Lambda
> function.

So `Authorization, x-api-key` means "send both" — a key got a 401 for lacking
`Authorization`, an access token got a 401 for lacking `x-api-key` — and one
header locks out whoever uses the other. There is no identity source meaning
"either", no header both kinds of caller send, and no way to switch the check
off (omitting the property with caching disabled still defaults to
`Authorization`).

The credential is therefore resolved *after* the gateway, by `lib/api-caller` —
the single function every `/v1` handler calls before it does anything else, which
is what the authorizer was doing anyway. `Bearer` first, then `x-api-key`, and the
credential's prefix (`play_sk_` / `play_at_`) decides how it is looked up. A key
presented as a bearer token works, so an integration that would rather send every
credential the same way is not doing anything wrong.

The `/v1` routes consequently carry **no `authorizer` key**, like the two public
catalog routes, and that is not an oversight: they authenticate themselves. What
changes is who refuses a stranger — the handler, answering this API's own
`{error:{code,message}}` shape, instead of API Gateway answering its bare
`{"message":"Unauthorized"}`. One DynamoDB read per call, nothing cached, exactly
as before.

### Scopes are what an app may do; a key's reach is what it always was

An API key is not scoped on its row. It holds the five reads
(`courses:read`, `lessons:read`, `lessons:stream`), plus
`organization:courses:read` when its owner named an organization — which is
exactly the reach keys have always had, now expressed in the vocabulary the OAuth
side uses so that a handler asks one question of either credential. A key never
holds `profile:read`: a key belongs to a script, and no person agreed to anything
about their own account when it was made.

**A key holds no write scope either, and that is the line the writes drew.** Three
things under `/v1` change somebody's own record — marking a lesson complete,
saving one to their favourites, and posting a comment under their name — and all
three are reachable only with an OAuth token whose owner agreed to the scope:
`learning:write` for the two toggles and `comments:write` for the one that speaks
for a person. `comments:write` covers replies as well as top-level comments, and
reading a discussion is not part of it: `GET /v1/lessons/{contentId}/comments` is
behind `lessons:read`, because anybody who may read a lesson may read what was
said about it. Reading that record (`learning:read`, on `GET /v1/me/learning`) is a
separate grant from changing it, because seeing what somebody has saved is not the
same permission as changing it, and a consent screen that merged them would be
offering more than its sentence said.

The reason writes are OAuth-only is not the scope table: it is that a key has
*nobody behind it*. A key is minted once, by a person, for a script, with a fixed
reach and no screen to agree to anything on — and there is no honest way to ask it
"may this comment appear under your name".

Each `/v1` handler names the scope it needs (`requireScope(caller, 'lessons:read')`)
rather than the authorizer deciding from the route. A fact about a route belongs
beside the route, where a new endpoint cannot be added without walking past it —
and the refusal names the missing scope, because an integration that has run out
of permission needs to know which permission to ask its user for.

### The five rules the OAuth side keeps

- **A consent screen redirects only to a URI the API has validated.** The studio
  reads the authorization request out of its own query string, hands it to the API
  unchanged, and builds the redirect from what comes back — never from the
  parameters it was opened with. Everything else about the flow (exact-match
  redirect URIs, PKCE required of every client, `state` echoed verbatim) exists to
  keep that one sentence true.
- **Two kinds of authorization failure, and they are not interchangeable.** An
  unknown client or an unregistered redirect URI is drawn as an error page and
  **nothing is redirected** — there is no verified place to send a browser, which
  is the whole risk. Everything after that point (an unregistered scope, an
  unsupported response type) is reported to the *app* by redirecting with
  `error=` in the query string, which is what every OAuth library is waiting for.
  `lib/oauth-authorize.ts` is where that line is drawn, once.
- **PKCE is required of every client, public or confidential.** A code travels
  through a browser, a redirect and (usually) a log; the verifier never leaves the
  client, and that is what makes a code that leaked on the way worthless.
- **Refresh tokens rotate, and tokens are opaque.** Redeeming a refresh token
  spends it and issues a new pair, so a copy of one is refused rather than being a
  second silent way in. There is no reuse *detection* — a client that lost the
  response to a refresh is indistinguishable from a replay without tombstones for
  every token ever issued, and guessing wrong there means revoking a working
  connection.
- **Changing an app's scopes ends its authorizations.** A person agreed to a list
  printed on a screen; an app whose list has changed is not the app they agreed
  to, so the next visit shows the consent screen again. Editing a name or a
  redirect URI disconnects nobody.

`apps/demo` is the worked example of all of this from the outside: it registers as
a public client, runs the flow by hand, and reads the classroom endpoints with the
token it is given. When a change to the OAuth surface would break a client, that
app is the thing to open — it is the only client here that is not Play.

