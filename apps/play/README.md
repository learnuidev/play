# `apps/play` — the console

A local control room for the backend. It answers three questions, and they are
the three that otherwise live in a shell history nobody can read:

- **Backends** — every environment the API has been deployed to, what each one
  was deployed with, what a new one needs before it can be deployed at all, and
  how a new one starts;
- **Frontends** — the three apps, what each one is handed, and where they run;
- **Integrations** — the AWS account the console acts as, and the Vercel account
  the two deployed apps live on, which the console can sign in to by running the
  Vercel CLI for you.

```bash
npm run play            # from the repository root
open http://localhost:3002
```

It is not deployed anywhere, and it is not a Play product surface. It runs on
your machine, with your AWS profile, and its subject is this checkout.

## The shape of it

The unit is **a backend, in an environment** — the whole console is about that
one sentence, so everything is downstream of it:

```
Frontends        /frontends        all three, what is up, and Start
                 /frontends/<app>  one of them — Env variables · Deployments · Logs
                                   ×  an environment

Backends         /backends         every environment, what is deployed, and
                                   Deploy to a new backend env
                 /backends/<stage> one of them — Checklist · Env variables ·
                                   Deployments · Logs

Integrations     AWS      who the console acts as, and what is deployed
                 Vercel   where the two deployed apps run — read-only, plus the
                          CLI sign-in that gets it a token
```

Which one, and against what, are **two dropdowns at the top of the page they
belong to**, in the same place, because they are the same shape of question. On
both lists the first of them *opens* something rather than selecting it in place:
a frontend, or an environment's backend. Both are routes, so one app's output and
one environment's stacks are each linkable, the back button returns to the list,
and the list keeps saying what all of them are doing while you read about one.
The environment dropdown on a frontend's own page is the shared stage, and it
writes the state the whole console reads, so moving between pages keeps the
environment you were looking at — and `/backends/<stage>` sets that same stage on
the way in, because the environment in the URL is the one the rest of the console
should be looking at.

Starting a frontend is **above the tabs**, beside the environment it would be
started against: it is the page's subject rather than one of its three views. A
backend has no equivalent control there, because its equivalent *is* one of the
tabs — the Deployments tab is the deploy page, and the six-hundred-word
consequences of pressing the button belong next to the button. The **short
Deploy on each row of the list** is the other half of that trade: the same press,
one page earlier, for the fourth deploy of an environment that has been up for
months. It is the small secondary button rather than the primary one, and the
Deployments tab is still where the checklist is read before a first deploy.

### Why `/backends` is a list of environments

There is one backend: the CDK app in `infra/`. The plural is about *where it has
been deployed*, so a row is a stage, and everything a row says is a fact about
five CloudFormation stacks — which are complete, whether this environment creates
its own tables, bucket and pool or imports another stage's, and where its API is.
Every environment exists whether or not anything has been deployed to it, so the
rows come from the repository's own list and the stacks only fill each one in: a
list drawn from the deployed stacks would be empty on a fresh checkout, which is
exactly when the first deploy has to happen.

**Deploy to a new backend env** asks for a name and then *opens* that
environment's page on its checklist — `/backends/<stage>?tab=deployments`. It does
not start a run, and that is the point of it: a new environment needs its config
file first, the plan's third step is what writes one, and what the plan will do is
worth reading before it is run. The name is the only thing this console cannot
read off AWS.

There is therefore **no 404 for a stage nobody has configured** — that page is the
one this console most needs to draw, and `/backends/staging` works the moment
somebody has thought of it. A name that could never be a stage *is* a 404, because
the alternative is a page about nothing.

The environment is deliberately not in the rail. A list there would be a second
place to select the same thing, which is a second answer to one question — and
naming a new one lives on the list where the environments are, rather than in the
chrome, so the rail is left with the three parts of the problem instead of a menu.

### Which tab, in the URL

An environment's page and a frontend's are each a strip of tabs over one page, and
**which tab is showing is `?tab=`** — `useTabParam` in
`components/ui/tabs.tsx`, shared by both. So `/backends/staging?tab=logs` is a
link somebody can be sent, a reload lands where the reloader was, and the tab a new
environment opens on comes from the same parameter the strip writes. Anything the
list does not know — a typo, a tab that has been renamed — is the first tab rather
than an error, which is what makes the parameter safe to leave out.

Switching a tab **replaces** the current history entry rather than pushing one. The
back button on these pages is documented above as leaving the page for the list,
and a `push` per tab change would quietly turn it into a walk back through the
strip. `scroll: false` for the same kind of reason: `router.replace` scrolls to the
top by default, and a strip halfway down a long page would jump out from under the
pointer that clicked it.

**A row that is deploying says so.** Its chip reads *deploying*, with a spinner
rather than a dot, and the line underneath is the step the run is on rather than
the stack count — because a deploy in flight leaves exactly the half-built set of
stacks that *partly deployed* describes, so the row that would otherwise shout
loudest is the one that is working correctly. That verdict comes from
`/api/deploy/runs`, which is this process's own memory and free to read, and not
from `/api/state`, which is cached and costs two `aws` processes — a deploy's
progress is stale within seconds, a stack's status is not. The same function
draws the chip on the environment's own page and on the deploy card, so a row
cannot say "deploying" above a page that says "partly deployed". While that is
true the row's **Deploy** button is disabled rather than hidden, because the chip
beside the name already says why — and a refusal the server *does* send, from the
race between two tabs, is printed in the row rather than swallowed.

### Checklist — what a person has to supply

The tab a new environment starts on, and the only one that is a *question* rather
than a report. Five rows, each a requirement with a tick or a sentence about what
is missing:

| Row | Met when |
| --- | --- |
| The config file | `infra/config/play-<stage>.json` exists — saving the credentials below is what writes a new environment's |
| Google sign-in | there is a client id, a secret in Secrets Manager, and callback and logout URLs |
| Mail and origins | the invitation sender and the two app base URLs |
| Payments | there is a Stripe API key and a webhook signing secret in Secrets Manager, a publishable key in SSM, and an endpoint to point Stripe at. **The one row that does not hold up a deploy** — see below |
| The CloudFront signing key | both halves of *this environment's* pair are in SSM, at `/play/<stage>/cloudfront/*` — the one row with a button, because it is generated rather than typed |

The form below the rows is the credentials form, and it is open by default
whenever something is missing: a page that told you the credentials were absent
and then made you go and find the form would have wasted the hint. A stage with
no config file gets a **draft** rather than an error — the product's values under
this stage's name, carried over from a stage that has them — so the first save is
what creates the environment. The card above it prints the two values Google has
to be told, derived from the pool's future domain, because registering the OAuth
client is the step *before* pasting the id and secret — and it is there on every
stage, not only on one that is missing something, since the values are outputs to
copy rather than fields to fill in.

### Env variables — inputs, and outputs

The one tab that is not the same on both pages, because the two directions are
opposite. It is read-only on both — a backend's values are *written* on the
Checklist tab, a frontend's are handed to it when it starts — and what it adds is
where each one comes from and who reads it.

- **A backend's inputs** are what a *person* supplies, because nothing can
  discover them: the Google OAuth client, its secret, the origins Cognito will
  accept, the address invitations come from. They are written by the form on the
  Checklist tab and read by a deploy.
- **A backend's outputs** are what the *deploy* produces — the API URL, the pool,
  its app client, the Hosted UI domain, the distribution.
- **A frontend's variables** are those same outputs with different names. A
  frontend has none of its own; the table's job is to show the copy each one is,
  and where it came from.

Calling all of it "environment variables" would hide the only thing worth knowing
about any of it: which direction the value travels, and who reads it.

### Deployments

For a backend, this tab *is* the deploy page — the fourteen-step checklist, the
transcript, the button — plus what CloudFormation has actually done, read from
the stacks rather than remembered by this process, plus the card an environment is
deleted from at the very bottom. A history kept on `globalThis` would begin when
you opened the page. The environment it is about comes from the URL rather than
from the shell's selection: `/backends/<stage>` *is* that environment, and a
checklist that drew another stage's step notes while the shell caught up would be
a page about two environments at once.

For a frontend it is where the app is running: locally from here, and on Vercel
if that project is connected.

### Two environments at once

There is **one run per environment**, not one run per console. `staging` and
`dev` deploy side by side, each with its own checklist, transcript, result and
Stop button, and the page you are reading is scoped to the environment in its
URL — `/backends/staging` polls *staging's* run and streams *staging's*
transcript, and never the other one's. Two requests for the *same* stage are
still refused by name, because two `cdk deploy --all` runs against one set of
stacks do not compose.

Three things make that safe rather than merely allowed:

- **Each stage synthesizes into its own directory** — `cdk.out/<stage>`. That
  directory is the whole of what a deploy reads, templates and staged assets
  together, so two runs sharing the default `cdk.out` would each read the other's
  templates and report a diff for stacks nobody asked about. It is also deleted
  before each synth, because CDK never prunes an assembly: every build leaves its
  staged assets beside the previous one under a new content hash, which is how one
  staging directory reaches a gigabyte.
- **The steps that touch something shared hold a named lock.** `plan.ts` marks
  them, and `server/run.ts` queues them: `infra/dist` (one bundle for every
  stage) and `apps/<app>/.env.local` (one file per app) are `checkout`, and
  `CDKToolkit` (one stack per account and region) and the shared videos bucket's
  notification configuration (one document, read and put back) are `account`.
  They are two names rather than one lock so that a staging bootstrap does not
  hold up a dev bundle. A step that has to wait says so in its transcript, with
  the reason, because a run parked for four minutes with no output reads like a
  hang.
- **What cannot be made private is left as it is, and said out loud.** A stage
  that *imports* its media shares one bucket with every other stage that imports
  it, and that bucket notifies one function: deploying two such stages at once
  ends with whichever deploy landed last owning video processing, exactly as
  deploying them one after the other would. `.env.local` is the same shape of
  fact — the apps point at one environment at a time — so a parallel deploy of
  `staging` leaves them pointed at `staging` and away from `dev`. An environment
  that creates everything (the normal case for a new stage) shares neither.

The deploy page says when another environment is deploying, so the button never
looks contended: what it tells you is that the run next to it is somebody else's.

### Logs

For a backend: CloudWatch, **one function at a time**, event-driven ones first.
`FilterLogEvents` takes a single log group and a new environment has 158 of them,
so fanning out per request would be 158 API calls to draw a screen. The
event-driven ones come first because they never answer a request and therefore
have nowhere else to say anything.

For a frontend: the `next dev` output, straight from the process the console
started — including one started before the page was opened, because the server
keeps the buffer.

### DynamoDB tables — the one view that reads the product

Everything else in the console describes the *deployment*: what it needs, what it
published, what CloudFormation did, what it logged. This tab reads the rows —
whether the webhook wrote the payment, whether the membership is there, whether a
profile picked up the name somebody typed. Those questions otherwise end in a
terminal and a shell history nobody else can read, which is this console's whole
reason for existing.

The table is picked first, because everything below it is about that table, and
there are then **two views** of it — `?view=`, so `?tab=tables&view=info` is a
link somebody can be sent:

| View | What it is |
| --- | --- |
| **Data** | A page of rows, as a table (TanStack Table, sortable within the page) or as JSON. The JSON is the CLI's own output, `{ S: … }` wrappers and all, because that is the form that can be pasted back into `put-item` |
| **Info** | What the table *is*, from `DescribeTable`: status, size, key schema, indexes — and the row count, which DynamoDB refreshes about every six hours rather than per write |

**Aiming a read is a button on the Data view, not a third view.** Pressing
**query** opens the form *over* the table and pressing it again puts it away: a
query is something done to the rows in front of you, so the rows stay where they
are and the answer appears under the form that asked for it. As a view it would
have made "where am I" and "what am I doing" the same question, and running a
query would have moved you somewhere to show you the result.

The form is an attribute, an operator, a value and a type. **The two calls are
not the same read, and the tab says which one it made.** A `Query` needs a
partition key, and this tab knows which attributes those are because
`DescribeTable` says so: asking about a key is one round trip that reads what it
returns. Anything else is a `Scan` with a filter, which reads the table and
throws away what does not match — so the read is written out above the rows and
the counts underneath say how many rows it actually read. The keys are offered as
buttons, because that is the difference between one round trip and a full table
read and nobody should have to read a schema to take it.

Two smaller decisions worth knowing. The **type** of a value is always part of
what the tab says — `S`, `N`, `BOOL`, in words — because `172348` and `"172348"`
look identical and match differently, and a read that matched nothing says so
when the value looks numeric. And the **rows are sent to the browser exactly as
DynamoDB answered them**: both renderings come from one read, and a mapping in
the server would be a second answer to "what does this row say" that only one of
them used.

**It reads and never writes.** `DescribeTable`, `Query`, `Scan` — there is no
edit field and no delete button anywhere on it, deliberately: a control room that
can change the product's rows is one where a slip is data loss with no undo.

## Why it is a step at all

`cdk deploy` is one command, and the checklist around it is the point. A stage
that has never been deployed needs a config file, a bootstrapped account, a
bundled `dist/`, a handed-over S3 notification and five stacks — in that order,
some of which fail in ways that name nothing anybody can act on. Two of them are
idempotent scripts it is easy to run twice and hard to know you needed to run
once.

So the plan is written down, in `src/server/plan.ts`, as fourteen steps. Each step
is a **check** and an **apply**: the check asks "is this already true?", and when
it is, the step is a check mark with the reason beside it and nothing is run.
That is what makes a second press of the button cheap — on an environment that is
already up, most of the plan reports *already satisfied*. `buildDestroyPlan` sits
beside it with the six or eleven steps that go the other way, and the same check
first discipline: *Deleting an environment*, below, is that plan.

| # | Step | Already satisfied when |
| --- | --- | --- |
| 1 | The tools are on this machine | `aws`, the workspace's `cdk` and a Node ≥ 20 all resolve |
| 2 | This machine can act on the account | `sts get-caller-identity` works **and matches the account the config names** |
| 3 | The environment's resources are named | `infra/config/play-<stage>.json` exists, parses, and names the caller's account |
| 4 | The CloudFront signing key is in SSM | both halves — the private parameter the handlers read by name, and the public one the media stack creates the distribution's key from |
| 5 | CDK is bootstrapped in this account and region | the `CDKToolkit` stack is settled |
| 6 | The handlers are bundled | the bundler reports nothing to rebuild |
| 7 | The templates synthesize | never — this one validates |
| 8 | The videos bucket has one owner | the bucket is this environment's, **or** the S3 handover finds nothing overlapping |
| 9 | The Google client secret can be read at deploy | the pool is imported, **or** the secret is already in Secrets Manager |
| 10 | The five stacks deploy | never — `cdk deploy` is run, and reports "nothing to change" |
| 11 | Every stack is complete, with its outputs | every root stack is settled and carries `ApiUrl`, the pool and its client — the list is `ROOT_STACKS` in `src/server/aws.ts`, so a stack added to the CDK app and not to it is a stack the console would report an environment complete without |
| 12 | The three apps point at it | every `.env.local` already reads this stage's `ApiUrl` |
| 13 | The API answers | `GET /catalog/courses` returns 200 |
| 14 | The pool's pre sign-up trigger points here | the pool is this environment's, **or** it already calls `play-<stage>-link-federated-user` |

Steps 6 and 10 have no check on purpose, and they are the two where running the
tool *is* the check: `bundle.mjs` keeps esbuild's metafile and knows what is
stale, and `cdk deploy` against an unchanged environment is a no-op. Both report
"nothing to do" as a success, and the run draws that as a satisfied step rather
than a tick for work that did not happen.

### Step 4: the one thing a deployment needs that nobody can type

Every video plays through a CloudFront signed URL, which needs a key pair, and
neither half is in this repository: `cloudFrontPrivateKeyParam` holds the private
half as a **SecureString** the handlers read by *name* at request time — that is
what keeps a 1.7 KB credential out of a hundred Lambdas' environments — and
`cloudFrontPublicKeyParam` holds the public half, which `PlayMediaStack` creates
the distribution's `PublicKey` from at deploy. So a stage that creates its own
media cannot deploy without both.

The two parameters do **not** hold the same shape of value, and getting that
wrong is a silent break rather than an error: the private one holds **base64 of
the PKCS#8 PEM** — one line, because `lib/cloudfront-key` base64-decodes it at
request time — and the public one holds **the PEM itself**, because the media
stack hands it straight to CloudFront's `EncodedKey`. A PEM in the private
parameter looks configured in every console and signs nothing.

`infra/scripts/ensure-cloudfront-key.mjs` is what puts them there, and it is
**idempotent in the direction that matters: it never rotates a key that exists.**
CloudFront signs with the public key a distribution was *created* against, so a
new pair would invalidate every URL already handed out — rotation is a deploy of
a new public key, not a repair. The four cases are in the script's header: both
there is a check mark, a missing public half is derived from the private one, a
missing private half beside an existing public one is **refused**, and both
missing generates a 2048-bit RSA pair.

There is a **third parameter**, and this tab is not what writes it:
`cloudFrontPublicKeyIdParam` holds the *id* CloudFront assigns to the key the
media stack creates — the `Key-Pair-Id` every signed URL carries — and the media
stack publishes it during a deploy. The handlers read it by name, which is the
whole reason a key can be rotated by deploying one stack: a CloudFront key is
immutable, so a new key is a new id, and an id that crossed stacks as a
CloudFormation export could not change without the API stack being redeployed
around it. A stage that imports its distribution publishes the id it already
names in `existing.cloudFrontPublicKeyId`.

**One pair per environment**, named after the stage: `/play/<stage>/cloudfront/*`.
The pair signs one distribution's URLs, and one environment's handlers should not
be able to mint URLs for another's — so the default a new environment is written
with is its own, and the pair is generated the first time anybody needs it.

The exception is a stage that **imports** its distribution: `dev`'s key group is
the legacy one, so its private half has to be the parameter holding the key that
group was created against — the shared `/play/cloudfront/private-key` — and its
config says so. That is a fact about a migrated stage, not a default: the console
reports a pair that is not the environment's own rather than quietly repointing
it, because the parameter a config names is the key its distribution already
trusts.

The same script is what the console's Checklist tab calls when a new environment
is created, so on a stage that already has its pair the step is a check mark with
nothing behind it.

Two things are worth knowing about the division of labour. **The plan's check is
two parameters existing** — asking whether they are *usable* means reading the
private key, and the checklist is drawn on every page load, so that read belongs
to the script, which compares the halves whenever it runs and re-encodes a
private half that is stored as a PEM. And **the console's Checklist row reports
the pair's state, not its substance**: a stage whose parameters exist is a tick,
because the alternative is a secret read per tab.

### Step 9, and a CloudFormation limitation worth knowing

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

### Step 10, and the export CloudFormation will not delete

A cross-stack reference in this app is a CloudFormation **export**, and
CloudFormation refuses to delete an export that another stack still imports:

> Delete canceled. Cannot delete export
> PlayMediaStack-test:ExportsOutputRefVideoPublicKeyE69C3160FF6036AB as it is in
> use by PlayApiStack-test, … (and 2 more).

`cdk deploy --all` deploys the stack that *provides* an export before the stacks
that read it, so the change that **stops** exporting something cannot land in a
single pass: the provider runs first, is refused, and the readers — whose new
templates no longer import it — never get their turn. A person would have to
deploy the readers on their own (`cdk deploy PlayApiStack-<stage> --exclusively`)
and then everything, and then check that they got the order right. That is
exactly the sort of thing a Deploy button should not need to be told.

So the step does it. On a non-zero exit it reads the export's name out of the
failure (`refusedExportName`), asks CloudFormation who still imports it
(`list-imports`, because that sentence truncates at "(and 2 more)"), deploys those
root stacks on their own, and deploys everything again. What the transcript shows
is one red stack, a sentence saying what is being done about it, and a step that
ends satisfied.

Two deploys is not a retry: the first one genuinely cannot succeed. It is the one
transition `--all` cannot express, it happens when a resource is replaced by one
with a different logical id, and that is precisely how a CloudFront signing key is
rotated — so the change that made that rotation possible is the change that first
needed this.

### Step 8, and the two buckets a stage may not be able to create

A stage that creates its own media gets **names CloudFormation makes up** unless
its config names them, and that is deliberate. An S3 bucket name is unique across
*every* AWS account, so `play-<stage>-videos` is a name somebody else may already
hold — for a stage called `test`, one does — and the deploy then stops during
change-set validation with:

> Resource of type 'AWS::S3::Bucket' with identifier 'play-test-videos' already
> exists.

which reads like a leftover of ours and is not. So the buckets are generated by
default, and the config can name them (`videosBucketName`,
`cloudFrontLogsBucketName`) for a stage that already has them — naming a bucket
that exists is a *replacement*, so `staging` freezes both of its names.

The check is what turns that failure into a sentence: for a stage that froze a
name, this step asks S3 whether the bucket is free (`404`), ours (`200`), or
another account's (`403`), and whether a stack of this environment owns it at all
— the second way to be stuck, because a bucket is `RemovalPolicy.RETAIN` and
outlives the stack that made it. Either way the run halts before the deploy with
what to do about it, rather than after CloudFormation has named the bucket and
nothing else.

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
  distribution and the user pool, all empty and all this stage's own.

That second path is the point of the whole thing:

> **A new environment creates everything.** Its own 28 tables, its own videos
> bucket and CloudFront distribution, its own Cognito user pool — all empty, all
> retained if the stack is deleted. It imports
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

## Vercel: three places a token can live

The console reads Vercel and never writes to it — no project is created, no
variable is set, no deployment is triggered — and a read needs a token. There are
three, and the order between them is a decision:

| Token | Put there by | Beats |
| --- | --- | --- |
| `VERCEL_TOKEN` in the shell | you, for one `npm run play` | everything |
| the CLI's session | **Connect** on the page — that is, `vercel login` | the file |
| `apps/play/.env.local` | the token form on the same page | — |

**Connect runs the CLI.** If this machine has no `vercel`, it installs one first
(`pnpm i -g vercel`, or npm when there is no pnpm), then runs `vercel login` and
streams it into the card. The CLI prints a device URL and waits; the page lifts
that URL out beside the button, because it is the one thing somebody has to act
on, and the process is left alone until the code is approved in a browser. It is
a transcript rather than a spinner because that is what a device flow is: two
lines of output, then nothing, then either a session or a sentence about why not.

The token itself is **read from the CLI's store, not copied**: `vercel logout` in
a terminal is how it goes away, and the page says which of the three sources it
is reading. Vercel gives the CLI a short-lived access token, so a CLI source that
has lapsed steps aside for whatever else is configured and the card says so —
renewing it is the CLI's business in the CLI's own process, and a console that
drove that exchange would be writing to a store it does not own. Pressing Connect
again is the way back.

One case is worth knowing about, because its error message says nothing about
its cause. If the console's **process cannot write the CLI's own store** — it was
started inside a sandbox, a container, or a CI job that confines it to the
repository — `vercel login` completes the device flow and then fails to keep what
it got:

```
Error: Not able to create ~/Library/Application Support/com.vercel.cli/auth.json
(operation not permitted).
```

So when that store is not writable the CLI is pointed at `apps/play/.vercel-cli`
instead, the transcript says so, and the session is read from there. That
directory is gitignored, like the `.env.local` a pasted token goes in. Started
the normal way — `npm run play` in your own terminal — the CLI's own store is
used, and a session created by `vercel login` anywhere on the machine is the
console's too.

## The Checklist tab: what a deploy cannot discover

A new environment creates its own user pool, and a pool is built with a Google
identity provider — which needs a client id, a client secret and a list of
callback URLs. There is nowhere to look those up. They are the one input a deploy
cannot derive, which is why they have a screen: **Backends → the environment →
Checklist**.

| Field | Lands in |
| --- | --- |
| Google client id | `auth` in `infra/config/play-<stage>.json` |
| Callback URLs, logout URLs | `auth` in that file **and** the live app client — saving runs `set-auth-urls.mjs` for this stage |
| From address, the two app base URLs | `mail` in the same file |
| **Google client secret** | **Secrets Manager**, at `play/<stage>/google-client-secret` |

Everything is editable at any time, not only during a first deploy. What a change
does afterwards depends on the pool:

- An environment that **creates** its pool gets the two URL lists twice: the save
  writes them onto the client as soon as that pool exists, and the auth stack
  builds the client with the same list from the config file on every deploy.
- `dev` **imports** its pool, so there is no deploy that could apply them. The
  save is what reaches Cognito, by running
  `services/api/scripts/set-auth-urls.mjs` with this stage's own lists —
  `--stage` alone would not do, because the script's defaults are the product's
  deployed origins rather than this environment's.

Either way the outcome is reported beside the save button rather than assumed: a
stage whose pool does not exist yet is a sentence there, not a failed save. On a
stage that imports its pool, that sentence is the only record that a sign-in
would still be refused.

**The secret never touches the repository.** It is write-only in both directions:
sent to Secrets Manager on save, never read back, and the page shows only whether
one is stored. That is not fastidiousness — the config file is committed, and a
credential in it would be a credential in the history of every clone.

Secrets Manager rather than SSM because CloudFormation refuses an SSM Secure
reference in `AWS::Cognito::UserPoolIdentityProvider`; step 8 above has the
error message and the reasoning. The name is **per stage**, so two environments
cannot overwrite each other's credential.

Saving is validated before anything is written or sent: a client id that does not
end in `.apps.googleusercontent.com`, a callback URL that is neither https nor
localhost, a malformed email — all caught and reported together, rather than
surfacing as a Cognito rejection in the middle of an auth-stack rollback.

### The other half of the conversation

A federated sign-in involves Google, Cognito and the app, and **Google has to be
told two things it cannot derive** — so the page prints them, ready to copy, in a
"What Google has to be told" card. It sits directly **above** the credentials
form, because it is first in the workflow: you register the OAuth client in
Google, Google asks for these two, and only then does it hand back the client id
and secret the form below wants.

It is deliberately **outside** that form. The form collapses to a single *Edit*
card once nothing is missing — the right behaviour for fields nobody needs to see
on an environment that is already configured — and the two values here are not
fields: they are outputs, read off the deployment, with nothing to edit and two
buttons whose whole purpose is to be pressed. Inside the form they were reachable
only on an environment that was *missing* something, which is exactly backwards.

| Google client field | Value |
| --- | --- |
| Authorized JavaScript origins | `https://<cognito-domain>` |
| Authorized redirect URIs | `https://<cognito-domain>/oauth2/idpresponse` |

where `<cognito-domain>` is `play-<stage>-<account>.auth.<region>.amazoncognito.com`
for an environment that creates its pool, and whatever `dev`'s pool was given
years ago for the imported one. These are read off the deployed auth stack when
there is one, because that is the only place the domain is authoritative.

**Two lists, and both are needed.** These two say where *Google* may send a
person; `callbackUrls` says where *Cognito* may send them afterwards. Google
returns to Cognito, Cognito returns to the app. Missing either one fails
sign-in — and the first fails as a `redirect_uri_mismatch` page that names
nothing in this repository.

They are shown rather than editable: the origin and the `/oauth2/idpresponse`
path belong to Cognito, and the domain is fixed when the pool is created.

The deploy page raises the same thing earlier: an environment that needs
credentials and has none gets a callout above the checklist pointing here, so the
first thing you read is a sentence rather than a failed step.

### Taking money: the Stripe card

A course can be free or paid, and a **paid** one is a Stripe checkout. The
conversation that sets that up has the same shape as Google's, and the console
gives it the same treatment: a "What Stripe has to be told" card, above the
credentials form, holding the two things Stripe needs and one list.

| What | Where it comes from |
| --- | --- |
| The **endpoint URL** | `PlayPaymentStack-<stage>`'s function URL, published as `StripeWebhookUrl`. Read from the stack, never derived — a function URL carries a random subdomain assigned when the function is created |
| The **events to subscribe** | The five the handler acts on. Anything else is answered with a 200 saying it was ignored, so an extra subscription is harmless; subscribing to none of these is a payment that never becomes an enrolment |
| The **signing secret** to paste back | Shown by Stripe once, when the endpoint is created — which is why the card is *above* the form rather than beside it |

**Three credentials, and only two of them are secrets.** The API key (`sk_…`) and
the endpoint's signing secret (`whsec_…`) go to Secrets Manager, one secret each,
and are write-only in both directions — the form reports whether each is stored,
never what it is. The publishable key (`pk_…`) is not a secret at all: it is what
a browser loads Stripe.js with, so it goes to SSM as a plain `String` and the form
shows it. All three are prefixed-checked before anything is written, because the
three look alike in a dashboard and pasting the secret key into the publishable
field is a mistake that would reach a browser.

**Rotation is two steps, and the card says so.** Saving a new key writes it to
Secrets Manager, and a webhook container that is already warm keeps the old one
until it is recycled — so the second step is a deploy of the payment stack, or
waiting. A payment taken in between fails verification rather than being accepted,
which is the right way round.

**This row does not hold up a deploy**, and its note says so. The payment stack
creates a webhook and nothing else, no deploy reads a credential, and a stage with
no Stripe values deploys perfectly well — what a credential buys is a payment that
can be recorded. It is on the checklist anyway, because a marketplace that cannot
take money is exactly what this tab exists to catch, and the moment to say it is
before somebody publishes a course with a price.

What a buyer's payment *does* is on the backend side of the line, in two halves
that are deliberately in different stacks — one on the product's own surface, one
a public endpoint:

| | Where | What it does |
| --- | --- | --- |
| Opening a checkout | `POST /spaces/{spaceId}/checkout` in `PlayApiStack` | Resolves the course's price in Stripe, opens a hosted session, writes the attempt down as `PENDING` |
| Recording the payment | the webhook in `PlayPaymentStack` | Verifies the signature, marks the payment paid, and **enrols the buyer** |

Nothing in the first half grants access: a session being created is not money
arriving. The enrolment is `enrollInSpace` — the same call the register button
makes — and `functions/spaces/enroll.ts` refuses a course with a price, so the
webhook is the only way in. The membership *is* the record of payment, which is
why there is no second lookup that could disagree with it.

**The price is a number an author sets in the studio** (`Space.priceCents`, with
`priceCents`/`currency` on `PATCH /spaces/{spaceId}`), and the Stripe price object
is a cache the backend makes on the first checkout and stores back as
`stripePriceId`. That is why changing what a course costs is changing a number
rather than chasing an id through a dashboard, and why the marketplace's tile and
the studio's price field read the same field the API checks. The console's Stripe
card above is what makes all of it work: no credentials, no checkout.

## Where things are

```
src/server/
  repo.ts          the repository root, the three apps, the profile, the binaries
  exec.ts          running a process and turning its output into lines
  aws.ts           the AWS CLI as a function or two — every call is a read
  environments.ts  infra/config/play-<stage>.json, and the stack outputs an app needs
  settings.ts      what a person supplies: the config file, and the credentials —
                   the Google client secret and the stage's Stripe values
  plan.ts          THE BACKEND PLANS, one per direction: the fourteen steps a
                   deploy walks, and the six a delete walks
  signing-key.ts   the CloudFront key pair: is it in SSM, and putting it there
  run.ts           the run engine — steps, transcript, cancel, result — for both
                   kinds of run
  run-api.ts       one step's transcript after the fact, and the live stream
  services.ts      the three dev servers, and cleaning up after them
  vercel.ts        the Vercel client: the projects, and the one place a token is
                   attached, read or written
  vercel-plan.ts   THE FRONTEND PLAN: variables → domain → build → alias → ready
  vercel-cli.ts    the Vercel CLI: where it is, its session, and the sign-in run

src/app/api/
  state            who we are, and what exists            (GET, cached 5s)
  plan             the checklist before it has run        (GET)
  deploy           start, read or cancel one environment's  (POST / GET / DELETE)
                   run — `?stage=` names it, because more
                   than one can be going
  deploy/destroy   delete one environment: its four        (POST)
                   stacks and its config file
  deploy/runs      every backend run going right now        (GET)
                   — what the list of environments draws
                   its "deploying" from
  deploy/events    its transcript, as it happens            (SSE)
  deploy/transcript  one step's lines, after the fact       (GET)
  services         the three frontends                    (GET)
  services/[app]   start or stop one                      (POST / DELETE)
  services/events  all three on one stream                (SSE)
  environments/[stage]/settings
                   one environment's credentials and      (GET / PUT)
                   mail settings — a draft until the
                   file exists, and the write that
                   creates it
  environments/[stage]/signing-key
                   is the CloudFront key pair in SSM,     (GET / POST)
                   and putting it there
  backends/[stage]/env
                   inputs and outputs                      (GET)
  backends/[stage]/deployments
                   CloudFormation's own history            (GET)
  backends/[stage]/logs
                   the stage's functions, or one's logs    (GET)
  backends/[stage]/tables
                   the stage's tables, or one table's      (GET)
                   shape and a page of its rows —
                   `?table=`, and the form's `attribute`,
                   `operator`, `value` and `type`
  frontends/[app]/env
                   what one app is handed, for one stage   (GET)
  vercel           projects, deployments, env vars,       (GET / PUT)
                   domains — and the token itself
  vercel/deploy    deploy one frontend to Vercel, the     (GET / POST / DELETE)
                   run's checklist, and its transcript —
                   with the matching /deploy/events (SSE)
                   and /deploy/transcript (GET)
  vercel/login     start or cancel the CLI sign-in         (POST / DELETE)
  vercel/login/events
                   its output, as it happens                (SSE)

src/components/
  console/         the frame: the rail, the environment picker, the theme
  backends/        the list of environments, one environment's four tabs, and
                   the checklist of what it needs from a person
  frontends/       the list, one app's page, the environment picker both use,
                   and the Vercel deploy card
  integrations/    AWS and Vercel, and the sign-in stream
  deploy/          the checklist, the step rows, the transcript, the result,
                   the card an environment is deleted from, and the hook both
                   kinds of run are read through
  apps/            the service hook the frontend pages are built on
  settings/        the credentials form, the two cards the integrations have to
                   be told about (Google and Stripe), and the hook that loads it
  ui/              button, card, chip, field, tabs, picker — the design system
```

## Deleting an environment

The Deployments tab is also where an environment is deleted from, at the bottom,
below everything that is about the run you came for. It destroys the five
CloudFormation stacks **and** removes `infra/config/play-<stage>.json`, which is
the file that makes the stage an environment in this console at all — so the row
goes with it. The deletion is a tracked file, so it is yours to commit.

**The data is a tick.** Every stateful resource here is `RemovalPolicy.RETAIN`, so
`cdk destroy` on its own stops at the stacks and leaves 28 tables, both buckets,
the distribution, the user pool and every log group in AWS with nobody managing
them. Those orphans are not inert: they are what stops a redeploy of the same name
at early validation, and they are what an environment nobody can deploy to is
still paying for. Deleting the product's only copy of its data is a different act
from deleting the environment, though — the accounts and the courses do not come
back — so it is a checkbox in the confirmation rather than the whole of the delete:

- **Unticked (the default)**: the six-step plan. The stacks and the config file go,
  the data stays, and the run's last step reads back what is still there and what a
  redeploy of the same name will hit.
- **Ticked**: the eleven-step plan. Five more steps delete everything the
  environment stood on, and the last step reports what it could not take with it.

Which one ran is legible afterwards from the run itself — the steps are in it, and
the page reads `data` out of them rather than remembering what was ticked — so the
deleted-environment card says which of the two happened.

| What the tick adds | Where the names come from |
| --- | --- |
| The DynamoDB tables | `existing.tables` for a stage that imports them, `play-<stage>-*` for one that created them |
| Both S3 buckets, emptied first | the config, the `VideosBucketName` output read before the stacks went, the distribution's own origin and logging target, and `playmediastack-<stage>-*` |
| The CloudFront distribution | `existing.cloudFrontDistributionId`, or the domain matched against `list-distributions` — an id CloudFront assigned is written down nowhere |
| Its key group and public key | read off the distribution that trusted them |
| The user pool, with every account in it | `existing.userPoolId`, the auth stack's output, or the Hosted UI domain `play-<stage>-<account>` |
| Every `/aws/lambda/play-<stage>-*` log group | the account, by name rule |
| The signing key pair, the key's id, and the credentials the Checklist writes | `signingKeyParams`, the config's parameter names, and Secrets Manager — the Google client secret plus the stage's Stripe API key and webhook signing secret |

Two things are **reported rather than deleted** when the tick is set, and both are
in the run's own last step: a **shared** signing key pair — what a stage that
imports its distribution points at, the pair that distribution was created against,
which nothing in this repository can enumerate the readers of — and anything the
run could not take with it. Alongside them, in both shapes, it names the apps whose
`.env.local` still reads the API URL that just went.

That is why deleting is a **run of six or eleven steps** rather than one `cdk
destroy` behind a button, and why the button asks for the stage's name rather than
a click: `infra/scripts/teardown-legacy-stack.sh` is built the same way, for the
same reason. The steps are:

| # | Step | In which plan | What it is |
| --- | --- | --- | --- |
| 1 | This machine can act on the account | both | The deploy plan's own first step, shared — a delete in the wrong account deletes somebody else's environment |
| 2 | Nothing else stands on what this environment stands on | ticked | **Refuses**, before anything is destroyed, when another stage's config names the same table, bucket, distribution or pool: that resource is not this environment's to delete, and taking it would be another stage's data or sign-up silently disappearing |
| 2 | No shared pool is calling into this environment | unticked | **Refuses** when a shared pool's pre sign-up trigger calls this stage's `link-federated-user`: the stacks go and the pool stays, so Cognito would go on invoking a function that no longer exists and people could not sign up. With the tick this question disappears — the pool goes too — which is why the two plans guard differently |
| 3 | The five stacks are destroyed | both | `cdk destroy --all --force` — `--force` because every process here has stdin on `ignore`, so CDK's confirmation would read an end-of-file. Skipped, with the reason, when there is nothing deployed. This is also where the names only a stack knows are read: `VideosBucketName`, `CloudFrontDomain` and the pool id, out of the outputs, before the stacks that publish them go |
| 4 | No stack of this environment is left | both | The post-condition. A stack in `DELETE_FAILED` stops the run **before** the config file goes, because that is the case where the file is still worth having |
| 5 | The tables are gone | ticked | Every table of this environment, deleted and waited for — the CLI's own waiter, so the step ends when the table is gone rather than when the request was accepted |
| 6 | The media is gone | ticked | The distribution disabled, waited for and deleted; then its key group and public key; then both buckets, emptied and deleted. The order is forced: CloudFront will not delete an enabled distribution, and will not delete a key a key group still trusts |
| 7 | The user pool is gone, with every account in it | ticked | Its own step because it is the one deletion that is about people: a redeploy of the same name makes a **new**, empty pool and everybody signs up again |
| 8 | The log groups are gone | ticked | One per function, a hundred and fifty-odd of them — the webhook's included — and the first thing that stops a redeploy of the same name |
| 9 | This environment's signing key and secrets are gone | ticked | The SSM key pair, the key-id parameter, and the three credentials the Checklist writes — the Google client secret and the stage's Stripe API key and webhook signing secret. The leftovers the Checklist would otherwise have to create again, and the reason a stage that comes back comes back from the Checklist rather than from what the last one left behind |
| 10 | What is still pointed here | ticked | **Reports instead of applying**: what the delete could not take with it, and the three apps' `.env.local` files compared against the `ApiUrl` captured before the stack publishing it went away |
| 10 | What is left behind, and what a redeploy of this name will hit | unticked | **Reports instead of applying** too, and reads the account rather than predicting it: how many tables, buckets and log groups are still there by name, the pool with how many accounts are in it, the distribution if the environment imports one — and what each of them does to a redeploy of the same name |
| 11 | The environment's config file is removed | both | The last thing, and only once the stacks — and, when it was asked for, the data — are gone |

The reporting step in either plan is **satisfied by finding what it expected**: it
is a reading, not a decision, in the idiom of the deploy plan's pre-sign-up step.
Pointing the frontends somewhere else is a decision about this product rather than
a step toward deleting this environment, and so is whether the data should go —
which is why the tick is asked *before* the run rather than offered inside it. What
that step read is also the run's result: a delete's answer is not a URL but a list
of lines, which the page draws where a deploy draws its outputs.

The one thing the ticked plan leaves where it found it is what the environment does
not own: a signing key pair whose names a **shared** config points at stays in SSM,
because an older distribution was created against that pair and nothing here can
enumerate who else reads it. Everything else the Checklist would have to create
again is removed, so a stage that comes back comes back from the Checklist rather
than from whatever was left of the last one.

## What it will not do

- **Deploy anything by itself.** There is no timer, no watcher and no
  post-install hook. The plan runs when the button is pressed, and never
  otherwise.
- **Delete data it was not asked to delete.** The run destroys one stage's four
  stacks and removes its config file, after its name has been typed into the card
  — and the tables, the buckets, the pool and the log groups go only if the box
  beside that name was ticked, because a run that was not asked has no steps that
  could. It refuses to start when another stage's config names the same resources,
  and it leaves a shared signing key pair where it is. *Deleting an environment*
  above is the whole of what goes.
- **Deploy one environment twice at once.** A second request for a stage that is
  already deploying is refused by name: two `cdk deploy --all` runs against one
  set of stacks contend for the same resources, CloudFormation serialises them
  anyway, and the loser reports the other's half-finished state as a rollback.
  A *different* environment is a different set of stacks and deploys alongside it
  — see *Two environments at once* above for what that leaves shared.
- **Write to AWS outside the plan.** Every read on the state endpoint is a
  `describe`, a `list` or a `get-parameters`. The writes are four, all behind a
  button and none of them a deploy: the credential save (the config file, the
  Google client secret, and the stage's Stripe key, signing secret and publishable
  key), the signing key when it is missing, and nothing else. The plan's transcript shows the `cdk` and `aws` invocations it amounts
  to.
- **Survive its own dev server restarting.** The run and the service registry
  live on `globalThis`, so a hot reload keeps them. Restarting the console
  process stops the dev servers it started, rather than orphaning them; one that
  outlived its console another way — a `SIGKILL`, a crash — is adopted from the
  state file the console keeps about itself in the OS temporary directory, so it
  is shown rather than forgotten, and it is not killed by a console that did not
  start it.

## Reading the transcript

The checklist and the transcript are one interface. Twelve rows say what the plan
will do and how far it has got; the pane underneath is the step you have open,
following the one being worked on until you click another — at which point it
stops following, because a pane that yanks itself away from what somebody is
reading is worse than one that is a line behind.

A finished run's lines are fetched a step at a time rather than replayed on every
page load, which is why opening the console after a deploy costs nothing.
