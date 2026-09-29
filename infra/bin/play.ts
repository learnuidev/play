#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';

import { loadConfig } from '../src/config';
import { PlayApiStack } from '../src/stacks/api-stack';
import { PlayAuthStack } from '../src/stacks/auth-stack';
import { PlayDataStack } from '../src/stacks/data-stack';
import { PlayMediaStack } from '../src/stacks/media-stack';

/**
 * The Play backend, as four stacks.
 *
 * They are split by **what a change to one of them costs**, not by size:
 *
 * | Stack | Holds | Deploy frequency |
 * | --- | --- | --- |
 * | `PlayDataStack` | The tables | Rarely |
 * | `PlayMediaStack` | The videos bucket and distribution, plus the two media roles | Rarely |
 * | `PlayAuthStack` | The user pool and the pre sign-up trigger | Occasionally |
 * | `PlayApiStack` | The functions, their routes, and the IAM | Constantly |
 *
 * That split is the answer to the problem this migration exists to solve.
 * CloudFormation caps a stack at 500 resources, and the single Serverless stack
 * that held all of this was *at* 500 — so every route addition re-planned the
 * whole service, and the next function anyone added was a failed deploy. Here
 * the ceiling still exists; it is just assigned. Adding a route touches one
 * stack, and that stack has room.
 *
 * ## What each stack does with its stateful resources is `ownership`
 *
 * The first three stacks each hold one of the three stateful groups — the
 * tables, the media and the pool — and `ownership` in
 * `infra/config/play-<stage>.json` decides, per group, whether the stack creates
 * it or imports it:
 *
 * - **A new environment** sets all three `true` and imports nothing. Deploying
 *   it creates its own tables, bucket, distribution and pool, named
 *   `play-<stage>-*` and empty. This is what the deploy console writes for a
 *   stage that has never existed.
 * - **A migrated stage** sets all three `false`. Every resource is imported by
 *   physical name and is therefore *unmanaged*: CloudFormation will not change
 *   it and will not delete it. `cdk deploy --all` is then close to a no-op for
 *   everything but `PlayApiStack`, and if it is not, something is wrong.
 *
 * `false` exists for one reason: `dev`'s resources predate this app and hold the
 * product. It is not the default for a new environment, and a stage that copies
 * it inherits dev's data rather than getting its own.
 *
 * The stage is a context value, so one app describes every deployment:
 *
 *   cdk deploy --all --context stage=dev
 *   cdk synth --all --context stage=staging
 */

const app = new App();

const stage = app.node.tryGetContext('stage') ?? process.env.STAGE ?? 'dev';
const config = loadConfig(stage);

// Explicit account and region, never environment-derived.
//
// This is not tidiness. An imported table's ARN is built from the stack's
// account and region, and if those are unresolved tokens the ARN becomes a
// token too — which turns every cross-stack reference into a CloudFormation
// export/import, and makes a synth that once worked fail the first time two
// stacks have to agree. Literal values keep the templates plain strings.
const env = { account: config.account, region: config.region };

const data = new PlayDataStack(app, `PlayDataStack-${stage}`, {
  env,
  config,
  description: 'Play data: the DynamoDB tables — created, or imported from the migrated backend',
});

const media = new PlayMediaStack(app, `PlayMediaStack-${stage}`, {
  env,
  config,
  description: 'Play media: the videos bucket and CloudFront distribution, plus the media roles',
});

const auth = new PlayAuthStack(app, `PlayAuthStack-${stage}`, {
  env,
  config,
  description: 'Play auth: the Cognito user pool and the pre sign-up trigger',
});

new PlayApiStack(app, `PlayApiStack-${stage}`, {
  env,
  config,
  description: 'Play API: the functions, their routes, and the IAM that reaches the data',
  tables: data.tables,
  media: {
    videosBucketName: media.videosBucket.bucketName,
    distributionDomain: media.distribution.distributionDomainName,
    publicKeyId: media.publicKeyId,
    mediaConvertRoleArn: media.mediaConvertRole.roleArn,
    transcribeRoleArn: media.transcribeRole.roleArn,
  },
  auth: { userPool: auth.userPool },
});

// Tags so a resource in the console says which deployment it belongs to. Not on
// the imported ones — an unmanaged resource is not tagged from here, and a tag
// that only sometimes applies is worse than none.
Tags.of(app).add('Project', 'play');
Tags.of(app).add('Stage', stage);
Tags.of(app).add('ManagedBy', 'cdk');
