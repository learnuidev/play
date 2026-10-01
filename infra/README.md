# `infra` — the Play backend's infrastructure

An AWS CDK app in TypeScript. It deploys everything the backend runs on, and it
is the only place the backend's infrastructure is described.

It replaced a single Serverless Framework service — one CloudFormation stack of
500 resources, the maximum, with a plugin whose only job was to keep it under
that ceiling. `docs/migration.md` is the record of why and how; this file is the
map for working in it.

```bash
npm install                                  # once, at the repository root

export AWS_PROFILE="$(. scripts/api-config.env && printf %s "$API_AWS_PROFILE")"

npm run synth    --workspace play-infra      # build the handlers, then synthesize
npm run diff     --workspace play-infra      # what would change, before it does
npm run deploy   --workspace play-infra      # deploy every stack
npm run deploy:api --workspace play-infra    # deploy just the API
```

`cdk` takes the profile from `AWS_PROFILE`; there is no `--profile` flag. There
is one command of setup, once per account and region:

```bash
npm run bootstrap --workspace play-infra
```

## The stacks

They are divided by **what a change to one of them costs**, not by size.

| Stack | Holds | Deploy frequency |
| --- | --- | --- |
| `PlayDataStack` | The DynamoDB tables | Rarely |
| `PlayMediaStack` | The videos bucket and CloudFront distribution, plus the two media roles | Rarely |
| `PlayAuthStack` | The Cognito user pool and the pre sign-up trigger | Occasionally |
| `PlayPaymentStack` | The Stripe webhook Stripe calls, and the names of the credentials it works with | Occasionally |
| `PlayApiStack` | The REST API, its authorizer and gateway responses, the execution role, the three event-driven functions, and four nested stacks holding the 130 route functions | Constantly |

Whether the first three **create** or **import** what they hold is `ownership` in
`infra/config/play-<stage>.json`, one flag per group:

- **A new environment** sets all three `true`. Every table, bucket, distribution
  and pool is created, empty and this stage's own — which is what
  `apps/play` writes for a stage that has never existed.
- **A migrated stage** sets all three `false` and names them. `dev` is the only
  one, and it is `false` because its resources predate this app and hold the
  product. An imported resource is unmanaged: CloudFormation will not change it
  and will not delete it.

The two stacks that own no stateful group are the other half of that rule:

- `PlayApiStack` creates everything it holds, because a Lambda, a route and a log
  group are all replaceable and the worst outcome of getting one wrong is a 500.
- `PlayPaymentStack` creates its webhook for the same reason, and holds no
  credential at all: it holds the **names** of the two Secrets Manager secrets and
  the one SSM parameter this deployment's Stripe values live in, and the console's
  Checklist tab is what writes them. A stack that created the secret would own a
  value it did not know, and the next deploy would fight the console's write
  rather than carry it.

`PlayApiStack` reaches CloudFormation's 500-resource limit on its own — 134
functions, a log group and a permission each, 133 methods, 87 CORS preflights and
101 gateway resources is about 850 — so the routes are divided into four nested
stacks, one per feature, each with its own budget. `src/stacks/api-groups.ts`
says why, and enforces the rule that makes it safe.

```
bin/play.ts                 the app: stage, config, the five stacks
src/config.ts               what the deployment stands on, read from config/
src/paths.ts                where things are, found rather than counted
src/naming.ts               one key → a Lambda name, a construct id, a table name
src/bundling.ts             handler entry point → Lambda code + handler string
src/types.ts                the shapes in src/generated/
src/generated/service.ts    GENERATED — every function, route and table schema
src/stacks/                 one file per stack, plus the API group partition and
                            the environment map every handler is handed
scripts/                    the tools below
config/                     the discovered resource names, one file per stage
dist/                       the bundled handlers (gitignored, ~700 MB)
```

## Where things come from

Two files decide what gets deployed, and neither is generated at deploy time.

- **`config/play-<stage>.json`** is what the deployment *stands on*: the physical
  name of every table, the bucket, the distribution, the user pool, and the
  non-secret deploy-time settings. `scripts/import-state.mjs` reads it out of AWS
  once and commits it. Read [config/README.md](config/README.md) before editing.
- **`src/generated/service.ts`** is what the backend *is*: every function, its
  routes, its timeout, and every table's key schema and IAM actions. It was
  transcribed from `serverless.yml` by `scripts/generate-from-serverless.mjs`
  when the migration ran, and it is the source of truth now. It is not
  hand-edited — except to add something, which is the documented way to add a
  route or a table, because the script that wrote it can no longer run.

**A table the config does not name is created, even on a stage that imports.**
`PlayDataStack` decides per table rather than per stage: `dev` names the 27 tables
the legacy backend created, and a table this app has added since — `PaymentsTable`
was the first — cannot be among them, because it does not exist until something
creates it. Importing a name that is not there would be a table every handler
reads and no table at all, failing as a `ResourceNotFoundException` at the first
request. So `dev` gains this app's newer tables as its own: created empty, named
`play-dev-<table>`, and retained like every other table here.

**A function with `ownRole` belongs to another stack.** `link-federated-user` is
in `PlayAuthStack` and `stripe-webhook` is in `PlayPaymentStack`, both for the same
reason: the stack that owns what the function is *about* is the stack that must
own the function, because the alternative is two stacks referencing each other and
CloudFormation refusing the cycle. `planGroups` and `offlineFunctions` both skip
them; the stack that owns one finds it in `FUNCTIONS` by key.

The app makes **no AWS calls at synth time**. That is deliberate and it is worth
keeping: a lookup that misses does not fail, it writes a parameter's *name* into
a Lambda's environment, and the failure surfaces as a 500 at the first request.

## Taking money: `PlayPaymentStack`

A course can be free or paid, and a paid one is a Stripe checkout. That needs
three things from an environment, and this stack is what creates exactly one of
them:

| What | Where it comes from |
| --- | --- |
| The **webhook** Stripe calls | Created here: `play-<stage>-stripe-webhook`, a Lambda with **no API Gateway route** — Stripe has no Cognito token — answering on a function URL published as `StripeWebhookUrl` |
| The **credentials** it works with | Written by the console's Checklist tab, read at request time: the API key and the endpoint's signing secret from Secrets Manager, the publishable key from SSM |
| The **payments table** | Created by `PlayDataStack`, like every other table here |

The URL is an output rather than something a person derives, because a function
URL carries a random subdomain assigned when the function is created. Paste
`StripeWebhookUrl` into the Stripe dashboard as an endpoint, subscribe it to the
five events the handler acts on (`STRIPE_EVENTS` in `apps/play/src/server/settings.ts`
is the list; the handler's own `switch` is the authority), and paste the signing
secret Stripe shows you back into the console.

**The stack creates no secret and no parameter.** A stack that created one would
own a value it did not know, and the console's write would then be a fight with
the next deploy rather than the way the value is set — the same division the
Google client secret has, and `config/README.md` has the names.

Two consequences worth knowing before a deploy:

- **The webhook is public, and that is not a hole.** The request is authenticated
  by its `Stripe-Signature` header, verified against this environment's signing
  secret before the body is parsed; a request that does not verify is refused with
  a 400. What the function may then *do* is bounded by a role of its own: two
  tables and two secrets, and nothing else in the account.
- **Credentials are read once per container.** Saving a rotated key writes it to
  Secrets Manager, and a warm webhook keeps the old one until it is recycled — so
  the second half of a rotation is a deploy (or waiting). A payment taken in
  between fails verification rather than being accepted, which is the right way
  round.

## The scripts

| Script | What it does |
| --- | --- |
| `scripts/bundle.mjs` | esbuild, once, into `dist/` — one directory per handler. Incremental: it keeps esbuild's metafile and rebuilds only what an edit reached |
| `scripts/import-state.mjs` | Reads the existing resources out of AWS into `config/play-<stage>.json`. Read-only |
| `scripts/generate-from-serverless.mjs` | The one-shot transcription that produced `src/generated/service.ts`. Kept as the record of how |
| `scripts/adopt-cognito.mjs` | Points the imported user pool's pre sign-up trigger at the CDK function. Runs once, during the cutover |
| `scripts/retain-legacy-resources.mjs` | Marks the old stack's 35 stateful resources `DeletionPolicy: Retain` and updates the stack. Runs once, **before** the teardown |
| `scripts/teardown-legacy-stack.sh` | Removes the old Serverless stack **without deleting the data it owns**. Refuses unless the retention above is in place |
| `scripts/handover-s3-notifications.mjs` | Removes the legacy stack's S3 notification rule so the bucket's configuration has one owner. Runs once, before the first deploy |
| `scripts/ensure-cloudfront-key.mjs` | Puts an environment's CloudFront URL-signing key pair in SSM: `cloudFrontPrivateKeyParam` (the private half, a `SecureString` the handlers read by name) and `cloudFrontPublicKeyParam` (the public half `PlayMediaStack` creates the distribution's public key from). Per environment by default — `/play/<stage>/cloudfront/*`. Generates a 2048-bit RSA pair when neither is there, derives the public half when only the private one is, and **never rotates a key that exists** — rotation is a deploy rather than a script: write the new pair at new parameter names, bump `cloudFrontKeyVersion` in that environment's config, and deploy the media stack. A CloudFront key's material and name are immutable, so the version is what makes that deploy create a new key instead of failing, and `config/README.md` has the three edits. The console's Checklist tab runs it when a new environment is created |
| `scripts/provision-google-secret.mjs` | Copies the Google client secret from SSM into Secrets Manager at `play/<stage>/google-client-secret`. Needed before a stack that **creates** a user pool deploys — CloudFormation refuses an SSM Secure reference in `UserPoolIdentityProvider`. Idempotent. The console's Checklist tab is the way to do this by hand |

## Destroying a stage, and what it leaves behind

Every log group here is named (`/aws/lambda/play-<stage>-<function>`) and marked
`RemovalPolicy.RETAIN`, so that a stack delete is not a reason to lose the record
of what happened. The two S3 buckets are retained the same way — they hold the
video — and a *generated* bucket name is what makes that harmless: the next
deploy of the stage makes its own buckets, and the old ones sit there until
somebody decides what to do with them. A stage whose config **names** its buckets
does not have that escape: the next deploy cannot create a bucket that exists,
which is early validation failing with "Resource of type 'AWS::S3::Bucket' with
identifier 'play-staging-videos' already exists" once the stack is gone. The
deploy console checks for exactly that before a run starts.

**That is what `cdk destroy` leaves — not what deleting a stage leaves.** The Play
console's Deployments tab deletes a stage by running `cdk destroy` and then, when
the confirmation's **delete the data as well** box is ticked, removing every one of
these itself: the tables, both buckets with their contents, the distribution and
its key group and key, the user pool, the log groups and the stage's secrets. Left
unticked it removes the stacks and the config file only, and its last step reads
back what is still there — which is the state this section describes.
`apps/play/README.md` has both runs step by step under *Deleting an environment*.
What follows is what the leftovers do to a redeploy of the same name when they are
removed **by hand** instead, which is the case this section exists for.

The cost shows up when you **delete a stage and deploy it again
under the same name**: the retained log groups outlive the stack, and the next
deploy fails early validation because it is trying to create a log group that
already exists.

```
Early validation failed for change set cdk-deploy-change-set:
PlayAuthStack-staging/LinkFederatedUserLogGroup/Resource  (AWS::Logs::LogGroup …)
  Resource of type 'AWS::Logs::LogGroup' with identifier
  '/aws/lambda/play-staging-link-federated-user' already exists.
```

It names the log group and not the reason, which is why it is written down here.
The fix is to remove the orphans, which are logs of a stack that no longer
exists:

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/play-<stage> \
  --query 'logGroups[].logGroupName' --output text \
  | tr '\t' '\n' | xargs -I{} aws logs delete-log-group --log-group-name {}
```

A stage that has never existed does not hit this — it is only the
delete-and-recreate cycle. Deleting the log groups is a real decision rather
than housekeeping: they are the only record of what the destroyed stage did.

## Bundling, and why it is not `NodejsFunction`

`NodejsFunction` runs esbuild itself, once per function, at synth — 134 times.
Here esbuild runs once, ahead of synth, and the stacks reference the finished
directories with `Code.fromAsset`.

It is also what keeps each function inside Lambda's 250 MB unzipped limit. One
artifact for the whole service — which is what `serverless-esbuild` produced by
default — put every handler *and every handler's sourcemap* in one zip: 271 MB
at 62 functions, of which 159 MB was maps. One directory per function is about
2.4 MB, and the maps stay, which is what makes a CloudWatch stack trace nameable.

`dist/` is gitignored and rebuilt by `npm run synth`, `diff` and `deploy`, which
each run the bundler first.

## Adding a route

1. Write the handler under `services/api/src/functions/<group>/`.
2. Add it to `src/generated/service.ts` — the entry, the timeout, and its
   `http` routes with `authorized: true` or `false`.
3. `npm run synth --workspace play-infra`.

The route's first path segment decides which nested stack it lands in, and
`planGroups` throws at synth if the segment is unclaimed or claimed twice. That
check is not decoration: two stacks building the same gateway resource is a route
that works until it does not.

A route with **no authorizer** is public, or authenticates itself. The two
catalog routes and all of `/v1` are the second kind, and `docs/workspace.md`
says why an authorizer cannot be used there.

## The IAM

One execution role, shared by every function, with the grants in
`src/stacks/api-stack.ts`. The table half of it is generated: each table's
actions and whether its indexes were included, transcribed from the hand-written
policy this replaced.

Two things about it are deliberate rather than incidental. It is **derived from
the table objects**, so `${table.tableArn}/index/*` cannot be forgotten —
querying a global secondary index is a `Query` against the *index*, and a policy
that omits it is a table whose listings work and whose lookups do not. And it is
**not narrower than the policy it replaced**: splitting it per function is a
change to make on purpose, later, because a permission that is missing shows up
as a 500 immediately and one that is too wide does not.
