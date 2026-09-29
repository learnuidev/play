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

So the plan is written down, in `src/server/plan.ts`, as thirteen steps. Each step
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
| 7 | The videos bucket has one owner | the bucket is this environment's, **or** the S3 handover finds nothing overlapping |
| 8 | The Google client secret can be read at deploy | the pool is imported, **or** the secret is already in Secrets Manager |
| 9 | The four stacks deploy | never — `cdk deploy` is run, and reports "nothing to change" |
| 10 | Every stack is complete, with its outputs | all four root stacks are settled and carry `ApiUrl`, the pool and its client |
| 11 | The three apps point at it | every `.env.local` already reads this stage's `ApiUrl` |
| 12 | The API answers | `GET /catalog/courses` returns 200 |
| 13 | The pool's pre sign-up trigger points here | the pool is this environment's, **or** it already calls `play-<stage>-link-federated-user` |

Steps 5 and 9 have no check on purpose, and they are the two where running the
tool *is* the check: `bundle.mjs` keeps esbuild's metafile and knows what is
stale, and `cdk deploy` against an unchanged environment is a no-op. Both report
"nothing to do" as a success, and the run draws that as a satisfied step rather
than a tick for work that did not happen.

### Step 8, and a CloudFormation limitation worth knowing

`AWS::Cognito::UserPoolIdentityProvider` **cannot take an SSM Secure string**.
CloudFormation rejects the reference and names the property:

> SSM Secure reference is not supported in:
> [AWS::Cognito::UserPoolIdentityProvider/Properties/ProviderDetails/client_secret]

It rejects `{{resolve:ssm-secure:…}}` in `AWS::SecretsManager::Secret`'s own
`SecretString` too, so the value cannot even be moved across declaratively.
A `secretsmanager` reference *is* accepted there, so step 8 runs
`infra/scripts/provision-google-secret.mjs`, which copies the parameter into
Secrets Manager, and the auth stack reads it from there.

This only applies when the stack **creates** the pool — an imported pool already
has its Google provider attached and no deploy touches it — which is why the
step is a check mark on `dev` and real work on a new environment.

### Two steps the console is careful about

Both exist because a *migrated* stage shares its bucket and its user pool with
every other migrated stage, and each of those has something exactly one stage can
own. They are steps 7 and 13 — and **neither does anything for an environment that
creates its own**: a new environment's bucket belongs to nobody else, and its pool
is wired to its own trigger at deploy time, so both come back as a check mark.

- **The `uploads/` notification (step 7) must be handed over** — CDK's
  conservative handler appends its own rule to a bucket it did not create, and
  two rules for one event on an overlapping prefix is a deploy that fails with
  *"Configuration is ambiguously defined"*. But handing it over is not
  housekeeping: the bucket notifies **one** function, so the step takes video
  processing away from whichever stage had it. It therefore says so in its
  detail, names the function it is about to displace in its check, and names the
  one it moved from in its note.
- **The pre sign-up trigger (step 13) is reported, not moved.** It is the one
  step with `manual: true`: its check still runs and still says whose the trigger
  is, but the step stops there instead of applying. An optional step that applied
  itself would, on a staging run, quietly take federated sign-up away from `dev`
  — a change to a shared resource, made on behalf of somebody who pressed a
  button labelled "deploy this environment". The command to move it is printed
  in the transcript beside what the check found, for whoever decides it should
  be.

Step 13 is optional because a *migrated* stage's pool is **imported and shared**
— one pool, one pre sign-up trigger, and every stage deploys its own function.
Repointing it takes federated sign-up away from whichever stage had it, which is
a decision about which environment owns sign-up, not a step toward a working
deploy.

## A new environment creates everything

The unit is what the CDK app calls a **stage**: `cdk deploy --context stage=dev`
deploys `PlayApiStack-dev` and its three siblings.

A stage that does not exist yet needs one thing — `infra/config/play-<stage>.json`
— and step 3 writes it. Which of two files it writes depends on whether the stage
already exists:

- **The legacy `play-backend-<stage>` stack is still there.** The stage predates
  the CDK migration and its data is real, so it runs `import-state.mjs`, the
  documented read-only discovery path, and the file names the resources it found.
  This is what `dev` did, and it is the only case in which a stage imports
  anything.
- **There is no legacy stack.** The stage is new, so there is nothing to discover
  and nothing to import. The file is written with `ownership` set for all three
  groups, which tells the stacks to **create** the tables, the bucket, the
  distribution and the user pool, all named `play-<stage>-*`.

That second path is the point of the whole thing:

> **A new environment creates everything.** Its own 27 tables, its own videos
> bucket and CloudFront distribution, its own Cognito user pool — all empty, all
> named after the stage, and all retained if the stack is deleted. It imports
> nothing, so it cannot read or write another environment's data.

Not *everything* is new: the mail addresses, the Google client id, the callback
URLs and the CloudFront signing key are **product** configuration rather than
per-environment state, so they are carried over from a stage that has them. A
stage that invented its own would be a stage whose Google sign-in does not work.

### Why `dev` is different

`dev` sets all three switches to `false` and imports. Its resources predate this
CDK app by years and hold the product, and an imported resource is *unmanaged*:
CloudFormation will not change its properties and will not delete it. That is the
entire reason the migration did not lose any data.

`false` is not the default for a new stage, and a new stage does not get it.
Seeding one from `play-dev.json` would copy `ownership: false` **and** dev's 27
physical table names — which reads like a new environment and behaves like a
second front door to dev's database. The console does not do that.

[`infra/config/README.md`](../../infra/config/README.md) has the full contract,
including what turning a migrated stage into an owning one costs: a new user pool
has no accounts in it.

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
  plan.ts          THE PLAN: the thirteen steps, their checks and their work
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
