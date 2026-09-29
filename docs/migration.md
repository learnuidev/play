# The backend, moved off Serverless Framework

`services/api` used to be one Serverless Framework service: one CloudFormation
stack (`play-backend-dev`) holding 500 resources — CloudFormation's ceiling,
exactly — with 65 nested stacks and a plugin whose only job was to keep it under
that number. It is now an AWS CDK app in [`infra/`](../infra/README.md): eight
stacks, none of them near a limit, described in TypeScript in this repository.

This document is the record of what moved, what deliberately did not, and what
is left to do. [workspace.md](workspace.md) is the map of the repository and
[deploy.md](deploy.md) is how the two frontend apps are deployed. The CDK app's
own map is [`infra/README.md`](../infra/README.md).

## What it was, and what it is

| | Before | After |
| --- | --- | --- |
| Stacks | 1 root at 500 resources + 65 nested | 4 top level + 4 nested, largest 279 |
| Config | `serverless.yml`, 3,093 lines | `infra/src` and `infra/bin`, TypeScript |
| Handlers | 134 functions, 133 routes | unchanged — same files, same routes |
| Tables | 23, described in YAML | 23, **imported**; schemas preserved in `infra/src/generated/service.ts` |
| IAM | 26 statements listing 49 ARNs by hand | derived from the table objects, one statement each |
| Bundling | `serverless-esbuild`, one artifact per function | `esbuild` directly, one artifact per function |
| Deploy | `serverless deploy` | `cdk deploy`, after `cdk synth` and `cdk diff` |

Nothing under `services/api/src` moved. The handlers, the libraries and the types
are exactly what they were; what changed is everything that described them.

## What did not move, and why that is the point

**The stateful resources are imported, not recreated.** Every table, the videos
bucket, the CloudFront distribution and its key group, and the Cognito user pool
with its app client are referenced by name:

```ts
dynamodb.Table.fromTableName(this, 'VideosTable', config.existing.tables.VideosTable)
cognito.UserPool.fromUserPoolId(this, 'CognitoUserPool', config.existing.userPoolId)
```

An imported resource is **unmanaged**. CloudFormation does not put it in the
stack's template, will not change its properties, and will not delete it. That is
the whole reason this migration could not lose data — and `cdk deploy` on a
fresh checkout is very nearly a no-op because of it.

The rule it comes from is the one thing to carry forward:

> **Import what holds data. Create what does not.**

The other half is the corollary: importing is not the same as managing. There are
consequences, they are real, and they are worth reading before the first change
that touches auth:

| Because it is imported | What it means |
| --- | --- |
| The user pool and its client | The callback URLs Cognito accepts are **not** deployed. `services/api/scripts/set-auth-urls.mjs` writes them straight to Cognito, and the console's Settings save runs it with that stage's own lists. It used to write SSM and tell you to redeploy; that deploy no longer exists, and could not work |
| The same pool | Setting the pre sign-up trigger is `infra/scripts/adopt-cognito.mjs`, for the same reason |
| The CloudFront public key | On `dev`, rotating the signing key is a CloudFront API call against the key group the imported distribution trusts, because the stack neither creates that key nor the group that lists it. `generate-cloudfront-keypair.sh` ends with what that takes. A stage that **creates** its media has a key the media stack owns, so its rotation is a config change instead — new parameter names, `cloudFrontKeyVersion` up, deploy |
| The tables | Nothing will notice if one is deleted, and nothing will recreate it. Point-in-time recovery is not on — enabling it is an in-place call, and worth doing for the tables whose loss would be more than an inconvenience |
| Everything imported | It is not tagged, and it does not appear in `cdk diff`. That is what "unmanaged" means |

## The eight stacks

They are split by what a change to one of them costs.

| Stack | Holds | Count |
| --- | --- | --- |
| `PlayDataStack` | The 23 tables, imported | 1 |
| `PlayMediaStack` | Bucket and distribution, imported; the MediaConvert and Transcribe roles, created | 4 |
| `PlayAuthStack` | The pool, imported; the pre sign-up trigger, created | 5 |
| `PlayApiStack` | The REST API, authorizer, gateway responses, execution role, the 3 event-driven functions, 4 nested stacks | 28 |
| `PlayApiStack-ApiContentRoutes` | videos, sections, contents — 46 functions, 69 methods | 279 |
| `PlayApiStack-ApiCoursesRoutes` | spaces, cohorts, rewards, catalog — 32 functions, 53 methods | 209 |
| `PlayApiStack-ApiPeopleRoutes` | organizations, me — 26 functions, 46 methods | 172 |
| `PlayApiStack-ApiPublicApiRoutes` | v1, oauth — 26 functions, 52 methods | 191 |

### Why the API is divided

The API does not fit in one stack: 134 functions with a log group and a
permission each, 133 methods, 87 CORS preflights and 101 gateway resources comes
to about 850 resources. That is not a surprise — it is the wall this migration
exists to get away from, and Serverless hit it exactly.

`serverless-plugin-split-stacks` answered it by moving resources into nested
stacks *by logical id*, re-deciding the partition on every deploy. That is what
made renaming a function able to leave the service holding two nested stacks for
it and 501 resources in the root, which is a template that does not validate.

The partition is now written down, in
[`infra/src/stacks/api-groups.ts`](../infra/src/stacks/api-groups.ts), and the
groups are the product's own vocabulary. **A path's first segment belongs to
exactly one group** — not a preference, a requirement, because each stack builds
its own slice of the gateway's resource tree and two stacks creating `me` is two
resources with the same parent and path part. API Gateway accepts that silently
and serves whichever it feels like.

`planGroups` enforces it and every route having a home, at synth, in a second,
with a message naming the group to add.

## What was verified

The migration was checked against the live API before anything was deployed,
because the alternative is checking it in production.

| Check | Result |
| --- | --- |
| Route table | `cdk synth`, resolved to paths, against `aws apigateway get-resources` on the running API: **220 methods over 102 resources, identical** |
| CORS preflights | Same 87 resources, same `Allow-Methods` per path, same `Allow-Headers` |
| Authorizer | Same name, type, 300-second cache, `Authorization` identity source, same pool ARN |
| Gateway responses | `DEFAULT_4XX` and `DEFAULT_5XX`, same CORS headers |
| Lambda environment | All 35 variables, identical values — the imported ones as literal strings instead of `Ref`s, which resolve to the same names |
| IAM | The same actions per table. The media role, the session policy and the SSM parameter grant are unchanged |

Then, deployed, against the **running** APIs:

| Check | Result |
| --- | --- |
| Every method on both APIs, called | **220 of 220 returned the same status code** |
| Every CORS preflight | **87 of 87 identical** — same code, same `Allow-Methods`, same headers |
| Public catalog response | byte-identical JSON |
| S3 → Lambda | a probe upload fired `play-dev-process-video`, which logged the expected skip and exited clean |
| The same 220 methods again, after the legacy stack was deleted | unchanged |

What could not be checked, and still cannot be without credentials, is an
*authenticated* call — signing in, and playing a lesson through a signed URL. The
authorizer's configuration was compared resource-for-resource, and it rejects
what it should; that it *accepts* is the one thing a person has to confirm.

## The cutover

This has been run for `dev`. The steps are here in the order they have to happen
for a stage that has not been migrated — and they are the order they were
**discovered** to need, which is not the order they were written in. Three of
them exist because the obvious approach does not work; each says so.

### 1. Bootstrap, once per account and region

```bash
npm run bootstrap --workspace play-infra
```

### 2. Hand the S3 notification over — once, and before the first deploy

```bash
node infra/scripts/handover-s3-notifications.mjs --plan
node infra/scripts/handover-s3-notifications.mjs
```

**Skipping this fails the deploy**, with:

> Configuration is ambiguously defined. Cannot have overlapping suffixes in two
> rules if the prefixes are overlapping for the same event type.

`put-bucket-notification-configuration` replaces a bucket's *whole* notification
configuration, and two rules for the same event with an overlapping prefix are
rejected outright. The old stack already has a rule — `s3:ObjectCreated:*` on
`uploads/`, to `play-backend-dev-process-video` — and because the bucket is
**imported**, CDK's `Custom::S3BucketNotifications` handler does not replace it.
That handler is deliberately conservative: on a create it reads what is on the
bucket, treats everything it finds as somebody else's, and appends its own rules.
With a bucket CDK created itself it replaces the configuration; with
`Bucket.fromBucketName` it cannot know which rules are stale, so it keeps them.
Two owners, one bucket, and the deploy fails on the second rule.

The script removes the colliding rules and nothing else, so a bucket some other
system also listens to keeps that system's rules. It is idempotent — run it a
second time and it finds nothing to do.

Uploads are not processed between running it and the deploy that follows. That
window is the point of the step, not a side effect of it, which is why it is
something you run on purpose rather than something `npm run deploy` does before
showing you the diff.

### 3. Deploy, and read the diff first

```bash
export AWS_PROFILE="$(. scripts/api-config.env && printf %s "$API_AWS_PROFILE")"

npm run diff   --workspace play-infra    # what would change
npm run deploy --workspace play-infra    # deploy all four
```

Three of the four stacks create almost nothing: the tables are imported, so
`PlayDataStack` is one `AWS::CDK::Metadata` resource. `PlayMediaStack` creates
the two media roles and the bucket policy, `PlayAuthStack` the trigger function.
Everything that costs anything is in `PlayApiStack`.

**Do not point anything at the new API yet.** The pools, the tables and the
bucket are shared, so both APIs work against the same data at the same time —
which is the point of doing it this way.

If step 2 was skipped, this is where it fails. Delete the `ROLLBACK_COMPLETE`
stack it leaves behind — CloudFormation cannot update a stack in that state — and
start again:

```bash
aws cloudformation delete-stack --stack-name PlayApiStack-dev
aws cloudformation wait stack-delete-complete --stack-name PlayApiStack-dev
```

The log groups it created are `DeletionPolicy: Retain`, so the rollback leaves
them behind and the next deploy fails on `already exists`. Clear them:

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/play-dev- \
  --query 'logGroups[].logGroupName' --output text |
  tr '\t' '\n' | xargs -n1 aws logs delete-log-group --log-group-name
```

### 4. Probe the new API directly

The `ApiUrl` output of `PlayApiStack-<stage>`, with a real API key, a real OAuth
token, and the keys screen's own flows. Comparing answers against the old API is
the reason both are up.

### 5. Point the apps at it

```bash
# or edit each .env.local by hand
npm run get-env
```

`get-env` reads the CDK stacks now — `PlayApiStack` for the URL and
`PlayAuthStack` for the pool, client and Hosted UI domain. The pool does not
move, so `NEXT_PUBLIC_COGNITO_*` is unchanged and existing sessions keep working.

```bash
grep NEXT_PUBLIC_API_URL apps/*/.env.local
```

Rollback is putting the old URL back: the old stack is untouched and still has
all 23 tables.

### 6. Repoint the user pool's pre sign-up trigger

```bash
node infra/scripts/adopt-cognito.mjs --show
node infra/scripts/adopt-cognito.mjs
```

The pool is imported, so nothing deployed can set `LambdaConfig.PreSignUp`. Until
this runs it points at the *old* stack's `link-federated-user` — and that function
disappears in step 7, at which point **sign-up stops working**. The failure does
not look like a deleted stack, which is why the teardown script refuses to run
until this has been done.

### 7. Mark the stateful resources `Retain`, then remove the old stack

```bash
node infra/scripts/retain-legacy-resources.mjs --plan   # the 35 resources
node infra/scripts/retain-legacy-resources.mjs          # applies DeletionPolicy: Retain

infra/scripts/teardown-legacy-stack.sh --plan           # what would go, what would stay
infra/scripts/teardown-legacy-stack.sh
```

**Two commands, not one, and the first is not optional.** There is no flag that
makes `delete-stack` keep resources:

> When you delete a stack, specify which resources to retain only when the stack
> is in the DELETE_FAILED state.

`--retain-resources` is the retry path for a deletion that *already failed* — you
run it again and skip whatever blocked it. Against a healthy stack CloudFormation
rejects the call outright, before deleting anything, which is a good way to find
this out and a bad way to rely on it.

What works is `DeletionPolicy: Retain`, a *template* attribute: CloudFormation
leaves the resource in place and stops managing it. So the retain script takes
the stack's own template, adds the policy to the 35 resources that hold state —
23 tables, the buckets, the bucket policy, the CloudFront pieces, the pool and
its client, and the S3 notification marker — and updates the stack with it.

Nothing is modified by that update: a deletion policy is not a resource property,
so the marked resources do not even appear in the change set. What does appear is
one entry per nested stack, and one per `AWS::Lambda::Permission` flagged
`Conditional` because its `FunctionName` is an `Fn::GetAtt` of a function whose
ARN cannot be resolved while the change set is computed. The script refuses only
on a `True` replacement, and prints the count so the reasoning is visible.

The template is staged in S3 rather than passed inline: at 543 KB it is ten times
over the 51,200-byte `--template-body` limit, and the CLI reports that as
`HTTP content length exceeded 251904 bytes` wrapped in an XML parse error — which
reads as a broken installation rather than as a template that is too big. It is
why Serverless uploaded this template too, and the bucket it left behind is where
ours goes.

The teardown then checks the CDK stacks exist, checks the pool's trigger has been
repointed, **checks that every stateful resource is marked `Retain` and refuses
to run otherwise**, empties the one bucket that is about to be deleted rather
than retained (S3 will not delete a non-empty bucket, and that is a
`DELETE_FAILED` on a stack that has already deleted everything else), prints the
retained list, and verifies afterwards that the tables are still `ACTIVE`, the
pool still exists, and the bucket still has its notification.

### If the deletion fails

It will not roll back — CloudFormation stops in `DELETE_FAILED` with most of the
stack already gone and the blocking resource(s) still there. The script prints
which ones and why. Clear whatever it was and run it again; the retained
resources were never at risk, because the deletion policies were in place before
the first attempt.

The one this deployment hit: Serverless's deployment bucket, with 1.2 GB of
zipped handlers in it. `aws s3 rm --recursive` and a second run finished it.

### 8. Optional, and worth it

Point-in-time recovery on the tables whose loss would be more than an
inconvenience. In-place, no data touched:

```bash
aws dynamodb update-continuous-backups --table-name <name> \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```

## Phase E, later or never

Imported resources stay unmanaged. Moving them under CloudFormation properly
means creating a new resource under a new name and copying the data, one table at
a time, in a window where losing a few seconds of writes is acceptable. The
schemas are not lost — they are in `infra/src/generated/service.ts`, which is
where they went when the YAML was deleted — and setting `ownership.tables` in
`infra/config/play-<stage>.json` makes `PlayDataStack` build them.

Do it when a property actually needs changing: throughput mode, a new index, a
stream. Not for tidiness.

The user pool is the last thing to move and the one to think hardest about.
Recreating it means every account re-registering and the Google federation being
rebuilt.

## What not to do

- **Do not create a table, a bucket or a pool with one of these names to "adopt"
  it.** CloudFormation fails the deploy with `already exists` or, worse, replaces
  it — and a replaced table is an empty table.
- **Do not `cdk import` a table the legacy stack still owns.** Wait for step 7.
- **Do not delete the legacy stack with a plain `delete-stack`.** 500 resources,
  23 of which are the product. `infra/scripts/teardown-legacy-stack.sh` exists
  because that command is one keystroke away.
- **Do not switch REST API to HTTP API in the same change as anything else.** The
  proxy event shape differs, so it reaches all 134 handlers at once.
- **Do not add an authorizer to `/v1`.** It accepts a credential from either of
  two headers, and API Gateway validates every header named as an `identitySource`
  on every request — so an authorizer there demands both and refuses every real
  caller. `docs/workspace.md` has the API reference quote.
- **Do not let a shell script deploy.** `set-mail-sender.sh` writes
  `infra/config/play-<stage>.json` as well as SSM, and the deploy reads the file.
  Changing only the SSM parameter is mail sent from the wrong address with
  nothing in the logs to say why.
