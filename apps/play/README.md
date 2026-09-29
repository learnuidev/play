# `apps/play` — the console

A local control room for the backend. It does two things, and they are the two
things that otherwise live in a shell history nobody can read:

- **deploys the backend to an environment**, as a checklist of every step a
  successful deployment needs, with a check mark for each one that is already
  satisfied;
- **starts the frontends locally against an environment** — the studio, the
  marketplace and the demo — without rewriting a single `.env.local`.

```bash
npm run play            # from the repository root
open http://localhost:3002
```

It is not deployed anywhere, and it is not a Play product surface. It runs on
your machine, with your AWS profile, and its subject is this checkout.

## Why it is a step at all

`cdk deploy` is one command, and the checklist around it is the point. A stage
that has never been deployed needs a config file, a bootstrapped account, a
bundled `dist/`, a handed-over S3 notification and four stacks — in that order,
some of which fail in ways that name nothing anybody can act on. Two of them are
idempotent scripts it is easy to run twice and hard to know you needed to run
once.

So the plan is written down, in `src/server/plan.ts`, as twelve steps. Each step
is a **check** and an **apply**: the check asks "is this already true?", and when
it is, the step is a check mark with the reason beside it and nothing is run.
That is what makes a second press of the button cheap — on an environment that is
already up, most of the plan reports *already satisfied*.

| # | Step | Already satisfied when |
| --- | --- | --- |
| 1 | The tools are on this machine | `aws`, the workspace's `cdk` and a Node ≥ 20 all resolve |
| 2 | This machine can act on the account | `sts get-caller-identity` works **and matches the account the config names** |
| 3 | The environment's resources are named | `infra/config/play-<stage>.json` exists, parses, and names the caller's account |
| 4 | CDK is bootstrapped in this account and region | the `CDKToolkit` stack is settled |
| 5 | The handlers are bundled | the bundler reports nothing to rebuild |
| 6 | The templates synthesize | never — this one validates |
| 7 | The videos bucket has one owner | the S3 handover finds nothing overlapping |
| 8 | The four stacks deploy | never — `cdk deploy` is run, and reports "nothing to change" |
| 9 | Every stack is complete, with its outputs | all four root stacks are settled and carry `ApiUrl`, the pool and its client |
| 10 | The three apps point at it | every `.env.local` already reads this stage's `ApiUrl` |
| 11 | The API answers | `GET /catalog/courses` returns 200 |
| 12 | The pool's pre sign-up trigger points here | *(optional)* the pool already calls `play-<stage>-link-federated-user` |

Steps 5 and 8 have no check on purpose, and they are the two where running the
tool *is* the check: `bundle.mjs` keeps esbuild's metafile and knows what is
stale, and `cdk deploy` against an unchanged environment is a no-op. Both report
"nothing to do" as a success, and the run draws that as a satisfied step rather
than a tick for work that did not happen.

Step 12 is optional because the user pool is **imported and shared** — one pool,
one pre sign-up trigger, and every stage deploys its own function. Repointing it
takes federated sign-up away from whichever stage had it, which is a decision
about which environment owns sign-up, not a step toward a working deploy.

## A new environment is a stage, and a stage is cheap

The unit is what the CDK app calls a **stage**: `cdk deploy --context stage=dev`
deploys `PlayApiStack-dev` and its three siblings.

A stage that does not exist yet needs one thing — `infra/config/play-<stage>.json`
— and step 3 writes it. If the legacy `play-backend-<stage>` stack is still
there, it runs `import-state.mjs`, which is the documented discovery path and is
read-only. If it is not — which is the case for every stage that did not exist
before the CDK migration — the file is **seeded from a stage that has one**.

That second path is not a shortcut. It is the honest answer, because of the rule
the whole backend is built on:

> **The tables, the videos bucket, the CloudFront distribution and the Cognito
> user pool are imported.** An imported resource is unmanaged: CloudFormation
> will not change its properties and will not delete it.

What a stage imports is the same resources, because they are shared. A new stage
creates its own API, its own media roles and its own pre sign-up trigger, and
nothing that holds data. The console says so on the card, above the button,
before it is pressed.

Creating resources a stage would *own* is `ownership` in that config file, and
[`infra/config/README.md`](../../infra/config/README.md) says why it is `false`.
The console shows the three switches as they are and never offers to flip them.

## The frontends, and how "a specific environment" works

`startService` spawns `next dev -p <port>` in the app's own directory with these
in the process environment:

```
NEXT_PUBLIC_API_URL                 from PlayApiStack-<stage>
NEXT_PUBLIC_COGNITO_USER_POOL_ID    from PlayAuthStack-<stage>
NEXT_PUBLIC_COGNITO_CLIENT_ID       from PlayAuthStack-<stage>
NEXT_PUBLIC_COGNITO_DOMAIN          from PlayAuthStack-<stage>
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED     from PlayAuthStack-<stage>
```

**Nothing on disk is rewritten.** `@next/env` fills in a key only when
`process.env` does not already have it, so an injected value wins over
`.env.local` and the file keeps saying exactly what it said. That is what makes
it safe to use while somebody is halfway through editing that file — and it is
the reason the deploy plan's step 10, which *does* write the files, is a
separate and visible thing.

*"As configured"* is the other half: no injection at all, and the app runs
against its own `.env.local`.

Each dev server is spawned **detached**, in its own process group, because
`next dev` starts a compiler and workers underneath itself and killing only the
process the console holds leaves the rest holding the port. Stop kills the group.

## Where things are

```
src/server/
  repo.ts          the repository root, the three apps, the profile, the binaries
  exec.ts          running a process and turning its output into lines
  aws.ts           the AWS CLI as a function or two — every call is a read
  environments.ts  infra/config/play-<stage>.json, and the stack outputs an app needs
  plan.ts          THE PLAN: the twelve steps, their checks and their work
  run.ts           one run at a time, its transcript, and its event stream
  services.ts      the three dev servers, and cleaning up after them

src/app/api/
  state            who we are, and what exists            (GET, cached 5s)
  plan             the checklist before it has run        (GET)
  deploy           start, read or cancel the run          (POST / GET / DELETE)
  deploy/events    its transcript, as it happens          (SSE)
  deploy/transcript  one step's lines, after the fact     (GET)
  services         the three frontends                    (GET)
  services/[app]   start or stop one                      (POST / DELETE)
  services/events  all three on one stream                (SSE)

src/components/
  console/         the frame: the rail, the environment picker, the theme
  deploy/          the checklist, the step rows, the transcript, the result
  apps/            the three cards
  ui/              button, card, chip — the whole design system, such as it is
```

## What it will not do

- **Deploy anything by itself.** There is no timer, no watcher and no
  post-install hook. The plan runs when the button is pressed, and never
  otherwise. It also never runs `cdk destroy`.
- **Deploy two things at once.** One run at a time, and a second request is
  refused by name. Two `cdk deploy --all` runs against one account contend for
  the same stacks, and the loser reports the other's state as a rollback.
- **Write to AWS outside the plan.** Every read on the state endpoint is a
  `describe` or a `list`. The writes are the ones in the table above, and the
  transcript shows the `cdk` and `aws` invocations they amount to.
- **Survive its own dev server restarting.** The run and the service registry
  live on `globalThis`, so a hot reload keeps them; restarting the console
  process forgets the services it started, and the exit handlers stop them
  rather than orphaning them.

## Reading the transcript

The checklist and the transcript are one interface. Twelve rows say what the plan
will do and how far it has got; the pane underneath is the step you have open,
following the one being worked on until you click another — at which point it
stops following, because a pane that yanks itself away from what somebody is
reading is worse than one that is a line behind.

A finished run's lines are fetched a step at a time rather than replayed on every
page load, which is why opening the console after a deploy costs nothing.
