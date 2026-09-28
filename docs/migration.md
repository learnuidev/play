# Moving the backend off Serverless Framework

`services/api` is one Serverless Framework service: one CloudFormation stack
(`play-backend-{stage}`), 134 Lambda handlers, 133 HTTP routes, 23 DynamoDB
tables, and a `serverless-plugin-split-stacks` plugin whose only job is to keep it
inside CloudFormation's limits. That plugin has run out of room, and the way it
runs out is not graceful.

This document is the plan for replacing it with AWS CDK. It is written to be read
before starting, not during: the order below is the part that matters, because the
data is the one thing that cannot be recreated.

[workspace.md](workspace.md) is the map of the repository and
[deploy.md](deploy.md) is how the two apps are deployed; this one is only about
the backend's infrastructure, and about the ceiling it is standing on.

## Where it stands today

| | |
| --- | --- |
| Root stack resources | **500 — CloudFormation's ceiling.** It validates and deploys, with zero headroom |
| Nested stacks | 65, one per newer function |
| Handlers / routes | 134 / 133 |
| Tables | 23 (17 have a `Name` stack output; 6 do not) |
| Hand-written CloudFormation | 40 resources in `resources:`, including the CloudFront distribution, the buckets, the user pool and three roles |
| Hand-written IAM | 26 statements listing 49 ARNs |
| `serverless.yml` | 3,093 lines |

The 500 is not the interesting number. The interesting number is **435**: the
resources the *service* generates, of which about 70 functions (Lambda + log group
+ permission each, plus their methods and resources) still live in the root stack
because `split-stacks` only migrates resources that were not already deployed:

> It only ever migrates resources that are *not* already in the deployed
> stack — everything already there stays where it is.

So the plugin splits the *new* half of the service and leaves the old half in the
root, and the two halves grow at different rates. There are no orphans to reclaim:
65 nested stacks, zero of them without a function behind them. The 500 is all live
resources, and the next function anyone adds is a failed deploy.

### What the ceiling has already cost

Three deploy failures in one week, none of them application bugs:

| Failure | Cause |
| --- | --- |
| `Circular dependency between resources: [… 49 nested stacks …]` | Renaming a function moved its nested stack to the end of the template while the `/v1` methods that depend on it stayed where they were; `stackConcurrency: 5` chains stacks `i → i−5`, and one dependency pointing forward closed the chain into a circle. Surfaced at `validateTemplate`, after packaging |
| `501` root resources | The same trap again: renaming a function key left the service holding two nested stacks for one function — one over the ceiling, which is a template that does not deploy |
| `401` for every `/v1` caller, valid credentials included | An API Gateway `REQUEST` authorizer declares every credential header as an `identitySource`, and CloudFormation validates them **on every request**: all must be present, so `Authorization, x-api-key` means "send both", which no real caller does |

The first two are properties of `split-stacks`, not of the service: it re-migrates
by logical id, keeps deployed nested stacks where they are, and adds ordering
edges of its own. The plugin's own README opens with:

> Using this plugin is a bad idea. It means you've allowed your serverless service
> to grow in to something huge.

## Why CDK

| What | Why it matters here |
| --- | --- |
| **IAM is derived, not written** | `table.grantReadWriteData(fn)` replaces hand-listed ARNs. Today every new table is a manual edit to a 49-ARN block, and a missing `${Table.Arn}/index/*` is a runtime 500, because querying a GSI is a `Query` against the *index* |
| **`synth` and `diff` are local** | Two of the three failures above were infrastructure errors reported only after eleven minutes of packaging or against a deployed API. `cdk synth` is instant and `cdk diff` shows the change before it is applied |
| **You own the logical ids** | The other failure class was `split-stacks` moving resources between nested stacks when a name changed. Nothing moves if nothing is renamed for you |
| **Stacks become a decision** | The 500-per-stack limit does not disappear; it is assigned. One feature today touches one stack of 500, and every deploy re-plans the whole service |
| **One language for infra and app** | The handlers are already TypeScript; the infrastructure is the only YAML |

What CDK does **not** fix: CloudFormation is still underneath. Stacks still
replace resources on immutable-property changes, rollbacks are still rollbacks, and
a `cdk deploy` still means a real change to a real account. There is also a
bootstrap stack to create once per account and region.

Two alternatives, for completeness:

- **Stay on Serverless and split the service in two** (app API, public API). Half a
  day, no new tooling, and it removes the ceiling. It is also the same seam the CDK
  migration lifts out first, so that work carries over rather than being wasted.
  Worth choosing if the priority is shipping this week rather than tooling.
- **AWS SAM.** Closer to what is here, but the same one-stack model, so it does not
  address the ceiling — only the YAML does not get better either.

## The rule the whole migration hangs on

**Import the stateful resources; create the stateless ones.**

| Kind | Resources | How |
| --- | --- | --- |
| **Stateful — import, never recreate** | 23 tables, the videos bucket, the CloudFront distribution, the Cognito user pool (and its client, domain and Google provider), the SSM parameters, the SES identity | `Table.fromTableName`, `Bucket.fromBucketName`, `Distribution.fromDistributionAttributes`, `UserPool.fromUserPoolId` |
| **Stateless — create fresh** | 134 Lambdas, 133 routes, the Cognito authorizer, the gateway responses, the IAM roles and grants, the log groups | Normal CDK constructs |

An imported resource is **unmanaged**: CDK will not change its properties and will
not delete it. That is the point — it is also why the imports are permanent-ish
until phase E.

What must never happen: creating a table with the same name to "adopt" it.
CloudFormation will fail the deploy (`already exists`) or, if it does not, replace
it — and a replaced table is an empty table. Every course, lesson, membership,
comment and credential lives in these 23 tables, and the user pool holds the
accounts.

## The stacks

| Stack | Holds | Deploy frequency |
| --- | --- | --- |
| `PlayDataStack` | The 23 tables. Imported now, owned in phase E | Rarely |
| `PlayMediaStack` | Videos bucket + policy, CloudFront distribution, key group, public key, OAC, logs bucket, MediaConvert and Transcribe roles | Rarely |
| `PlayAuthStack` | User pool, client, domain, Google identity provider, and the redirect URLs (per-stage parameters) | Occasionally |
| `PlayApiStack` | The 134 functions, their routes, the Cognito authorizer, the gateway responses, and per-function IAM derived from grants | Constantly |
| `PlayPublicApiStack` (later) | `/v1`, `/oauth` and the key-management routes, if that surface keeps growing faster than the rest | — |

Two things to get right in the API stack:

- **Bundle once.** `serverless-esbuild` produces one artifact per function today.
  Keep that: run esbuild once into `dist/` and have CDK reference the assets.
  134 `NodejsFunction`s each bundling their own copy is a synth that takes minutes
  and a deploy that takes longer.
- **One function per resource family, not per method.** The plugin's per-function
  strategy is why 65 nested stacks exist. In CDK, functions are cheap to *declare*
  — but they are still Lambdas, cold starts and metrics; group by resource the way
  `/v1` already groups the comment pair.

## The migration

### Phase A — make deletion survivable (30 minutes)

Nothing else in this document is safe until this is done. Add retention to the
tables in `services/api/serverless.yml` and deploy once:

```yaml
    VideosTable:
      Type: AWS::DynamoDB::Table
      DeletionPolicy: Retain      # the data outlives the stack
      UpdateReplacePolicy: Retain # and outlives a replacement
      Properties:
        # …as now
```

Do it for all 23 tables, and turn on point-in-time recovery for the tables whose
loss would be more than an inconvenience (`VideosTable`, `SpacesTable`,
`ContentsTable`, `ProfilesTable`, and the four OAuth tables).

**The two buckets already have `DeletionPolicy: Retain`; nothing else does.** The
user pool is the one to look at twice: deleting it takes every account with it,
including the federated ones, and there is no copy of them anywhere — so it wants
`Retain` before anything in this document is attempted. This is the insurance that
makes `serverless remove` — or a mistake in any later phase — survivable.

Also add the six missing stack outputs (`ApiKeysTableName`, `ProfilesTableName`,
`OAuthAppsTableName`, `OAuthGrantsTableName`, `OAuthTokensTableName`,
`OAuthCodesTableName`). The CDK import needs the physical names, and the outputs
are how the maintenance scripts already resolve them:

> `describe-stack-resources` is not usable here: it silently truncates at 100
> resources on this stack and returns no NextToken, so the tables never appear in
> it.

And once, for the new app:

```bash
npx cdk bootstrap aws://<account>/<region> --profile <profile>
```

### Phase B — the CDK app (1–3 days)

Create `infra/` at the repository root as its own package — add `"infra"` to the
root `package.json`'s `workspaces` list, so it installs with everything else and
`npm run typecheck` covers it — with one stack per row of the table above. Keep it
TypeScript, and keep the *handler table* generated rather than hand-written (step 3
below). Then, in this order:

1. **`PlayDataStack` and `PlayMediaStack`, imports only.** No resources created, no
   properties set on the imported ones. `cdk deploy` here should be a no-op that
   proves the account, the profile, the region and the names all line up.
2. **`PlayAuthStack`, imports only.** The pool, its client and its domain are
   referenced by id from the stack outputs.
3. **`PlayApiStack`, created fresh.** The function table is the mechanical part:
   for each of the 134 entries in `functions:`, one Lambda with the same handler
   path, the same environment and the same HTTP route. **Generate it from
   `serverless.yml`** — a script that reads the existing file and emits the CDK
   definition — so that nothing is missed and the YAML can be deleted afterwards
   rather than kept as a second source of truth.
4. **IAM from grants, not statements.** The 26 hand-written statements become
   `grantReadWriteData` / `grantReadData` calls on the tables and buckets each
   function actually touches. Read the current statements as the spec for who
   touches what; do not split them further in the first pass. A permission that is
   missing shows up as a 500 immediately; one that is too wide is a decision to
   make later, deliberately.
5. **Prove the pipeline with `/v1/me`** before moving the rest: one function, one
   route, a token, a real answer. The remaining 133 are repetition; a wrong
   assumption about the event shape is 134 wrong functions.

### Phase C — deploy beside, then cut over (2–4 hours)

The new API and the old one run at the same time, against the same tables. Nothing
about the old stack changes while this happens.

1. Deploy the CDK stacks. The old API keeps serving.
2. Probe the new API directly — with an API key, with an OAuth token, and with the
   keys screen's own flows. The point of running both is being able to compare
   answers.
3. Point the apps at it:

   ```bash
   # apps/studio/.env.local, apps/marketplace/.env.local, apps/demo/.env.local
   NEXT_PUBLIC_API_URL=https://<new-api-id>.execute-api.<region>.amazonaws.com/dev
   ```

   The user pool does not move in this phase, so the `NEXT_PUBLIC_COGNITO_*`
   values are unchanged, and an existing session keeps working.
4. Watch it for a day. Rollback is editing that one value back: the old stack is
   untouched and still has all 23 tables.

### Phase D — remove the old stack

Only once the apps have been on the new API long enough to trust it:

```bash
npm run remove --workspace play-backend -- --aws-profile <profile>   # or: npx serverless remove
```

Phase A is what makes this boring: every table has `Retain`, so the stack goes and
the data stays. Verify afterwards that the tables are still there before deleting
anything else. Then delete `services/api/serverless.yml`, its plugin
configuration, and the `.serverless` build directory.

### Phase E — own the data, later or never

Imported resources stay unmanaged. Moving them into CDK properly means creating a
new resource with a new name and copying the data, one table at a time, during a
window when the loss of a few seconds of writes is acceptable. Do it when a
property actually needs changing (throughput mode, a new index, a stream) — not
for tidiness. The same goes for the user pool, which is the last thing to move:
recreating it means every account re-registering and the Google federation being
rebuilt.

## What not to do

- **Do not recreate the tables or the user pool.** Import them, or leave them
  alone. Both failure modes here are data loss, and the pool's is the quieter of
  the two: it is cheap to recreate and the accounts are gone.
- **Do not use `cdk import` on a table that a Serverless stack still owns.** Wait
  for phase D.
- **Do not switch REST API to HTTP API in the same change.** The proxy event shape
  differs, so it reaches all 134 handlers at once — a separate, later decision.
- **Do not change the application framework.** `src/functions/**` and `src/lib/**`
  are portable as they are; the migration is about what describes them.
- **Do not rename anything that is already deployed while the old stack is live.**
  That is the trap that cost a circular dependency and a 501: a deployed name is a
  name, whatever the file beside it is called.

## Until then

While the service is on Serverless and at the ceiling:

- **No new functions.** A new Lambda is a new root resource, and there is no room
  for one. New routes go on an existing function — one function per resource
  family, which `/v1` already does for the comment pair.
- **Read the count before adding anything to `resources:`.** A table, a bucket or a
  distribution is spent headroom, not a local change.
- **Package before deploying** if a route, a name or a plugin configuration
  changed: `npx serverless package --package /tmp/pack` writes the root template
  out on its own, and the failure to look for is a dependency pointing *forward*
  into a nested stack on a chain. `aws cloudformation validate-template
  --template-url s3://…` then performs the check the deploy would fail on.
