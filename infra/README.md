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
| `PlayApiStack` | The REST API, its authorizer and gateway responses, the execution role, the three event-driven functions, and four nested stacks holding the 130 route functions | Constantly |

Whether the first three **create** or **import** what they hold is `ownership` in
`infra/config/play-<stage>.json`, one flag per group:

- **A new environment** sets all three `true`. Every table, bucket, distribution
  and pool is created, named `play-<stage>-*` and empty — which is what
  `apps/play` writes for a stage that has never existed.
- **A migrated stage** sets all three `false` and names them. `dev` is the only
  one, and it is `false` because its resources predate this app and hold the
  product. An imported resource is unmanaged: CloudFormation will not change it
  and will not delete it.

[`config/README.md`](config/README.md) has the full contract.

`PlayApiStack` reaches CloudFormation's 500-resource limit on its own — 134
functions, a log group and a permission each, 133 methods, 87 CORS preflights and
101 gateway resources is about 850 — so the routes are divided into four nested
stacks, one per feature, each with its own budget. `src/stacks/api-groups.ts`
says why, and enforces the rule that makes it safe.

```
bin/play.ts                 the app: stage, config, the four stacks
src/config.ts               what the deployment stands on, read from config/
src/paths.ts                where things are, found rather than counted
src/naming.ts               one key → a Lambda name, a construct id, a table name
src/bundling.ts             handler entry point → Lambda code + handler string
src/types.ts                the shapes in src/generated/
src/generated/service.ts    GENERATED — every function, route and table schema
src/stacks/                 one file per stack, plus the API group partition
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
  hand-edited, and the script that wrote it can no longer run — the YAML is gone.

The app makes **no AWS calls at synth time**. That is deliberate and it is worth
keeping: a lookup that misses does not fail, it writes a parameter's *name* into
a Lambda's environment, and the failure surfaces as a 500 at the first request.

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
| `scripts/provision-google-secret.mjs` | Copies the Google client secret from SSM into Secrets Manager at `play/<stage>/google-client-secret`. Needed before a stack that **creates** a user pool deploys — CloudFormation refuses an SSM Secure reference in `UserPoolIdentityProvider`. Idempotent. The console's Settings view is the way to do this by hand |

## Destroying a stage, and the log groups it leaves behind

Every log group here is named (`/aws/lambda/play-<stage>-<function>`) and marked
`RemovalPolicy.RETAIN`, so that a stack delete is not a reason to lose the record
of what happened. The cost shows up when you **delete a stage and deploy it again
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
