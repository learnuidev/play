# `infra/config` — what this deployment stands on

One file per stage. `play-dev.json` is the deployed backend: the physical name of
every DynamoDB table, the videos bucket, the CloudFront distribution and public
key, the Cognito user pool and its app client, and the deploy-time settings that
used to be `${ssm:...}` interpolations in `serverless.yml`.

It is written by a script and read by the CDK app. It is committed, and it is
meant to be read before a deploy — it is the one file that says *which* resources
a `cdk deploy` is about to be pointed at.

```bash
npm run import-state --workspace play-infra            # discover and write
npm run import-state --workspace play-infra -- --help  # every option
```

The script is read-only — every call it makes is a `describe`, a `list` or a
`get` — and safe to re-run. It merges into what is already there, so a hand edit
to a field it does not discover survives.

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
| `existing.tables` | Legacy logical id → physical table name. Keys match the construct ids in `src/generated/service.ts` |
| `existing.videosBucket` | The bucket the presigned uploads and CloudFront reads go to |
| `existing.cloudFront*` | The distribution, its domain, and the public key id handlers sign URLs with |
| `existing.userPool*` | The pool, its app client and its Hosted UI domain prefix |
| `existing.googleSignInEnabled` | Whether that pool has a Google identity provider |
| `mail.*` | The invitation sender and the two app base URLs. **Deploy-time, not runtime** |
| `auth.googleClientId`, `auth.callbackUrls`, `auth.logoutUrls` | Used only if `ownership.auth` is turned on. The live pool's values are read from Cognito by `set-auth-urls.mjs` |
| `cloudFrontPrivateKeyParam` | The *name* of the signing key parameter. Never the key |
| `ownership` | See below |

## `ownership`

```json
"ownership": { "tables": false, "media": false, "auth": false }
```

**All three are `false`, and `false` is what you want.** It means the stacks
import the resources that already exist rather than creating them. An imported
resource is *unmanaged*: CloudFormation will not change its properties and will
not delete it. That is the entire reason this migration did not lose any data —
and it is why `cdk deploy` on a fresh checkout is nearly a no-op.

Setting one to `true` means **create this instead of importing it**, which is a
data migration rather than a configuration change:

- `tables` creates 23 empty tables under new names. The point is to copy the
  data across, not to point it at the live ones — creating a table with an
  existing name fails the deploy with `already exists`, or replaces it, and a
  replaced table is an empty table.
- `media` creates a new distribution. A new distribution is a new domain name,
  which is a new URL in every player.
- `auth` creates a new user pool. That is every account re-registering,
  including the federated ones, and there is no copy of them anywhere.

This is phase E of `docs/migration.md`, and the guide there is to do it when a
property actually needs changing — not for tidiness.

## Keeping it true

Three commands change a resource this file names, and none of them is a deploy:

| Task | Command |
| --- | --- |
| A callback URL changed, or a new origin was deployed | `node services/api/scripts/set-auth-urls.mjs` |
| Google sign-in was enabled or rotated | `services/api/scripts/set-google-oauth.sh` |
| The invitation sender changed | `services/api/scripts/set-mail-sender.sh` |

The first two write to Cognito, because the pool and its client are imported and
no deploy can change them. The third writes this file, because those two values
*are* deployed — they are in every Lambda's environment.
