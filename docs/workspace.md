# Working in this repository

One npm workspace, four kinds of package. This is the map and the rules that keep
it from turning back into two apps with copies of each other's code.

```
play/
├── apps/
│   ├── studio/           Play Studio — the creator's app (Next.js, port 3000)
│   └── marketplace/      Play Marketplace — the learner's app (Next.js, port 3001)
├── packages/
│   ├── types/            @play/types     — the shapes the API and both apps agree on
│   ├── api/              @play/api       — the API client + React Query hooks
│   ├── auth/             @play/auth      — Cognito wiring, providers, the sign-in gate
│   ├── ui/               @play/ui        — design primitives
│   └── learning/         @play/learning  — the classroom, the player, course cards
├── services/
│   └── api/              play-backend    — Serverless Framework + TypeScript
└── scripts/
    └── get-env.mjs       reads the stack outputs into an app's .env.local
```

## Commands

```bash
npm install                       # once, at the root: one lockfile, hoisted node_modules

npm run dev:studio                # http://localhost:3000
npm run dev:marketplace           # http://localhost:3001

npm run build                     # both apps
npm run build:studio              # one app
npm run typecheck                 # every workspace that has a typecheck script
npm run get-env -- --profile=…    # stack outputs into both apps' .env.local
npm run deploy --workspace play-backend   # serverless deploy (services/api)
```

`npm run <script> --workspace <name>` runs a script in one workspace;
`--workspaces --if-present` runs it in all of them.

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

## Styling

Tailwind v4 scans the app's directory by default, so each app's `globals.css`
carries an explicit `@source` for the packages:

```css
@source "../../../../packages/ui/src";
@source "../../../../packages/learning/src";
```

Without it, the classes only the packages use are never generated and the shared
components render unstyled — which looks like a broken component rather than a
missing build setting.

Both apps import the same `globals.css` copy (the theme tokens and variants are
identical); if the design changes, it changes in both, and the primitives it
feeds live in one place.

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
- **The marketplace's front page speaks in a marketing register, and it is the
  only screen that does.** Large type, wide margins, one accent, and `Reveal`
  for blocks that arrive as they are scrolled to — where the app screens state
  what is on them, `/` makes a claim and then shows the evidence. The reviews on
  it are written for the page rather than collected, so replacing them with real
  ones is a copy change and never a wiring one.

The primitives in `@play/ui` are shared and stay deliberately plain: the
vocabulary above is applied at the composition layer (the shell, the page card,
the page itself) so the marketplace and the studio can move together without one
of them restyling the other's buttons.

## Authentication

One Cognito user pool for both apps, so an author in the studio and a learner in
the marketplace are the same account. `@play/auth` is where that lives:

- `AppProviders` — theme, query cache, tooltips, Amplify session, toasts.
  **No gate**: the marketplace's front page and its catalog both render for
  people who have not signed in.
- `AuthGate` — the sign-in wall, for everything that is only for signed-in
  people. The studio wraps its whole tree in it; the marketplace wraps the pages
  that need an account, and sends anonymous readers to `/sign-in?next=…`.
- `SignIn` — the sign-in screen itself, and the *only* place `socialProviders` is
  passed. A page that renders Amplify's `Authenticator` directly would silently
  offer passwords only, however the deployment is configured.
- `useIsSignedIn` — for pages that ask the API who the caller is, because "the
  courses I am in" is a 401 when nobody is signed in, not an empty list.

Redirect URLs are derived from `window.location.origin`, so the studio gets
`localhost:3000/auth/callback` and the marketplace `localhost:3001/auth/callback`
with no per-app configuration. Both must be registered on the user pool —
`custom.authDefaults` in `serverless.yml` lists both for local development, and
`services/api/scripts/set-auth-urls.sh` rewrites the SSM parameter that overrides
it (a value there wins over the defaults, and Cognito only re-reads the list at
deploy time).

Signing in with Google leaves the page entirely, so `?next=` does not survive it:
`rememberAfterSignIn` leaves a note in session storage and `OAuthCallback` reads
it on the way back. Anything routed through it is validated by `internalPath` —
`next` is attacker-supplied, and a sign-in page that forwards to a full URL is a
phishing link wearing the app's name.

## The backend

`services/api` is one Serverless service whose CloudFormation stack is
`play-backend-{stage}` — the directory was renamed when it moved in, the service
was not, because renaming it would rebuild the stack rather than update it.

```bash
npm run typecheck --workspace play-backend
npm run deploy --workspace play-backend -- --aws-profile <profile>
```

A new route is two things: a handler under `src/functions/**`, and a `functions:`
entry in `serverless.yml` with its path, method and `authorizer`. Leaving the
authorizer off is how the two public catalog routes are public, and it is the
only place in the service that happens on purpose.

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

## The public API and API keys

Everything in this service used to be called by one of our own two apps, with a
Cognito token behind it. `/v1` is the other kind of caller: a script, a partner's
backend, a customer's pipeline — something that cannot complete a sign-in — and
it authenticates with an API key in an `x-api-key` header.

The pieces, and where they live:

| What | Where |
| --- | --- |
| The key's row, its hash, and the lookup by secret | `services/api/src/lib/api-keys.ts` |
| The header-to-identity step | `services/api/src/functions/auth/api-key-authorizer.ts` |
| The public surface itself | `services/api/src/functions/public/*` |
| Making, listing and revoking keys | `services/api/src/functions/api-keys/*` |
| The screen that issues them | `apps/studio/src/app/api-keys` |
| The reference | `apps/studio/src/app/docs`, described by `apps/studio/src/lib/api-reference.ts` |

Four rules worth keeping:

- **A key is never stored, only its hash.** The secret exists once, in the
  response that creates it. Nothing can read one back, which is why "copy it now"
  is the shape of that dialog rather than a nicety.
- **`/v1` is read-only and deliberately small.** It is a surface somebody can
  integrate against and be held to, not every handler in the service opened to a
  second kind of caller. Adding to it is a decision, not a route.
- **The authorizer caches nothing** (`resultTtlInSeconds: 0`). Revocation takes
  effect on the next request, and the price — one read per call — is what
  identifying a caller costs everywhere else here.
- **A bad key is a Deny policy, not a thrown error.** API Gateway has three
  documented answers here: a Deny policy is a 403, a thrown error is a 500, and
  a missing `x-api-key` is a 401 from the gateway itself, because the route
  names that header as its identity source. Only the first two are ours to
  choose, and 403 is the one that means what happened.
- **The docs page is data.** A changed response is one object in
  `lib/api-reference.ts`, and the page, the examples and the cURL commands all
  come from it.
