# `infra/config` — what this deployment stands on

One file per stage. What is in it depends on which kind of stage it describes:

- **A migrated stage** — `dev` — names everything it imports: the physical name
  of every DynamoDB table, the videos bucket, the CloudFront distribution and
  public key, the Cognito user pool and its app client. This is the deployed
  backend, migrated off the legacy Serverless stack without moving any data.
- **A new stage** — anything else — imports nothing, so it names nothing. It has
  no `existing` block; `ownership` is the whole of what it says about resources,
  and the stacks create them, named `play-<stage>-*`.

Both kinds are committed and meant to be read before a deploy: the file is the
one place that says *which* resources a `cdk deploy` is about to be pointed at.

```bash
npm run import-state --workspace play-infra            # discover and write
npm run import-state --workspace play-infra -- --help  # every option
```

That script is for a **migrated** stage — it is how `dev`'s names were
discovered. It is read-only, safe to re-run, and merges into what is already
there, so a hand edit to a field it does not discover survives. A new stage does
not need it: the deploy console writes the file, and there is nothing to discover.

## Why a committed file, rather than a lookup

The CDK app could resolve these at synth: `StringParameter.valueFromLookup`, or
an `aws` call inside the app. It deliberately does not, for two reasons.

**A synth that reaches AWS is not a synth.** `cdk synth` is supposed to be
instant and local, and it is the thing that catches mistakes before a deploy.
Needing credentials and a network for it gives that up.

**A lookup that misses does not fail.** `valueFromLookup` returns the
*parameter name* when the parameter does not exist, and that string is then baked
into a hundred Lambdas' environments as a table name. The failure is a 500 at the
first request, days later, naming a table nobody has heard of. A committed file
that a person can read is a better answer — and where it is wrong, `cdk diff`
says so before anything is deployed.

## What is in it

| Field | What it is |
| --- | --- |
| `stage`, `account`, `region` | The deployment. Explicit, so every ARN built from them is a literal string rather than a token |
| `ownership` | Which of the three stateful groups this stage creates. See below |
| `existing` | **Only on a migrated stage.** Absent when `ownership` is all `true` |
| `existing.tables` | Legacy logical id → physical table name. Keys match the construct ids in `src/generated/service.ts` |
| `existing.videosBucket` | The bucket the presigned uploads and CloudFront reads go to |
| `existing.cloudFront*` | The distribution, its domain, and the public key id handlers sign URLs with |
| `existing.userPool*` | The pool, its app client and its Hosted UI domain prefix |
| `existing.googleSignInEnabled` | Whether that pool has a Google identity provider |
| `mail.*` | The invitation sender and the two app base URLs. **Deploy-time, not runtime** |
| `auth.googleClientId`, `auth.callbackUrls`, `auth.logoutUrls` | The Google client id, and the origins Cognito accepts. On a migrated stage the live pool's values are read from Cognito by `set-auth-urls.mjs` instead |
| `googleClientSecretName` | The Secrets Manager secret a **created** pool reads the client secret from. Defaults to `play/<stage>/google-client-secret`, which is per-stage so two environments cannot overwrite each other |
| `cloudFrontPrivateKeyParam` | The *name* of the signing key parameter. Never the key. Defaults to `/play/<stage>/cloudfront/private-key` |
| `cloudFrontPublicKeyParam` | The *name* of that key's public half. Defaults to `/play/<stage>/cloudfront/public-key` |

`auth` and `mail` are the two blocks a **person** writes rather than a script
discovers, which is why they have a screen: the console's **Checklist** tab, one
per environment. Everything else here is either a physical name read out of AWS
or a resource count.

**The CloudFront signing key pair is per environment**, and the two fields above
are only names: the key material lives in SSM, at `/play/<stage>/cloudfront/*`
unless the config says otherwise, and `infra/scripts/ensure-cloudfront-key.mjs`
generates it — once, never rotated. A stage that **imports** its distribution
names the pair that distribution was created against, because that is the only
pair its key group will accept a signature from; `dev` is the one stage here that
does, and it names the shared `/play/cloudfront/*`.

The two values are different shapes on purpose, and the script is the place that
knows it: the **private** parameter is base64 of the PKCS#8 PEM (what
`services/api/src/lib/cloudfront-key.ts` decodes), and the **public** one is the
PEM itself (what `PlayMediaStack` interpolates into CloudFront's `EncodedKey`).

**The Google client secret is not in this file**, and must not be. It is a
credential, this file is committed, and CloudFormation refuses the SSM Secure
reference that would let it be read in place — it lives in Secrets Manager and
the console writes it there. `apps/play/README.md` says why.

`existing` is validated **field by field, against `ownership`**: a name is
required exactly when the corresponding group is imported. So a stage that
imports its tables cannot leave one out, and a stage that creates them is not
asked for 27 names it was never going to have.

## `ownership`

```json
"ownership": { "tables": true, "media": true, "auth": true }
```

This is the switch that decides what "an environment" means, and there are two
answers:

| | Value | The stage | Its data |
| --- | --- | --- | --- |
| **New environment** | all `true` | Creates the tables, the bucket, the distribution and the pool, named `play-<stage>-*` | Its own, empty |
| **Migrated stage** | all `false` | Imports them by physical name | Shared with every other migrated stage |

**A new environment is all `true`, and that is what the deploy console writes.**
Deploying `staging` for the first time gives you staging's own 27 tables, its own
videos bucket and CloudFront distribution, and its own Cognito user pool — all
empty, and all named after the stage. Nothing is shared, so a deploy there cannot
change what `dev` reads, and there is no handover step to worry about because
there is only ever one owner of staging's bucket.

**All `false` is the migrated case, and it exists for exactly one stage.** `dev`'s
resources predate this CDK app by years and hold the product. An imported
resource is *unmanaged*: CloudFormation will not change its properties and will
not delete it. That is the entire reason the migration did not lose any data, and
it is why `cdk deploy PlayDataStack-dev` on a fresh checkout is a no-op.

The two are not interchangeable, and the difference is easy to get wrong in the
direction that matters: seeding a new stage from `play-dev.json` would copy
`ownership: false` and dev's physical table names with it, which reads like a new
environment and behaves like a second front door to dev's database. The console
does not do that — a stage with no legacy stack to discover gets a new-environment
config.

### Turning a migrated stage into an owning one

Only `dev` is migrated, and all `false` is right for it. For any other stage,
setting these to `true` when it was `false` is **additive**: imports create no
CloudFormation resources, so the stacks simply gain the ones they were missing.
What that means in practice:

- `tables` creates 27 empty tables. The Data stack currently holds a single
  `CDKMetadata` resource, so this is a create, not a replacement.
- `media` creates a bucket and a distribution. A new distribution is a new domain
  name, so stream URLs change for that stage only.
- `auth` creates a new user pool — **and a new pool has no accounts in it.**
  Existing users, including federated ones, do not carry over; that is the cost
  of a separate environment, and it is why `dev` keeps importing.

## Keeping it true

Three commands change a resource a *migrated* stage names, and none of them is a
deploy:

| Task | Command |
| --- | --- |
| A callback URL changed, or a new origin was deployed | `node services/api/scripts/set-auth-urls.mjs` |
| Google sign-in was enabled or rotated | `services/api/scripts/set-google-oauth.sh` |
| The invitation sender changed | `services/api/scripts/set-mail-sender.sh` |

The first two write to Cognito, because `dev`'s pool and its client are imported
and no deploy can change them. None of this applies to a new environment: its
pool is deployed, so its callback URLs are in `auth.callbackUrls` and a deploy
applies them.

The third writes this file, because those two values *are* deployed — they are in
every Lambda's environment.
