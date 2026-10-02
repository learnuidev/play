import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Arn, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import type { Construct } from 'constructs';

import { bundle } from '../bundling';
import type { PlayConfig } from '../config';
import { ownsEverything } from '../config';
import { TABLES } from '../generated/service';
import { pascal } from '../naming';
import { INFRA_ROOT } from '../paths';
import type { FunctionSpec } from '../types';
import { offlineFunctions, planGroups } from './api-groups';
import { ApiRoutesStack } from './api-routes-stack';
import { serviceEnvironment } from './environment';
import { parameterArn, stripeCredentialsGrant } from './grants';

/**
 * What the API needs from the media stack, and nothing else.
 *
 * The bucket is a **name**, not the media stack's bucket construct, and that is
 * load-bearing rather than tidy. `bucket.addEventNotification` creates its
 * custom resource in whichever stack owns the bucket object, so handing this
 * stack the media stack's bucket would put the S3 notification in the *media*
 * stack — which would then have to reference this stack's `process-video`
 * Lambda, while this stack references the media stack's roles. Two references
 * pointing in opposite directions is a dependency cycle, and CloudFormation
 * rejects it before anything is deployed.
 *
 * So this stack imports the bucket itself, from the same name, and the
 * notification lands here, in the stack that holds the function it invokes.
 */
export interface MediaRefs {
  videosBucketName: string;
  distributionDomain: string;
  /**
   * The CloudFront key id is deliberately **not** here.
   *
   * It is the one media value that changes without the media stack being
   * replaced — a rotated key is a new key with a new id — and a cross-stack
   * reference to it is an export that would have to be renamed when that happens,
   * which CloudFormation will not do while this stack imports it. So the media
   * stack publishes the id to the parameter named by
   * `cloudFrontPublicKeyIdParam`, and the handlers read it from there; see
   * `sharedEnvironment`.
   */
  /** A token, because the role is created by the media stack. */
  mediaConvertRoleArn: string;
  /** A token, because the role is created by the media stack. */
  transcribeRoleArn: string;
}

/** What the API needs from the auth stack. */
export interface AuthRefs {
  userPool: cognito.IUserPool;
}

export interface PlayApiStackProps extends StackProps {
  config: PlayConfig;
  tables: Record<string, dynamodb.ITable>;
  media: MediaRefs;
  auth: AuthRefs;
}

/**
 * The API: one REST API, 134 Lambdas, 133 routes, and the IAM that reaches the
 * data.
 *
 * Everything in this stack is created. Nothing here holds state — a Lambda, a
 * method and a log group can all be replaced, and the worst outcome of getting
 * one wrong is a 500 rather than a lost record. That is the other half of the
 * rule this migration turns on: import what holds data, create what does not.
 *
 * ## This stack does not hold the routes
 *
 * It holds the gateway they hang off, and hands each group of routes to a nested
 * stack — `api-groups.ts` says why there are groups at all and
 * `api-routes-stack.ts` says what is in one. The split is also what a person
 * reads to find a route: the group names are the product's own vocabulary, so
 * "where does a lesson's stream URL live" has an answer that is not a search.
 *
 * `cdk deploy PlayApiStack-dev` deploys all of it. The nested stacks are part of
 * this stack's template rather than siblings of it, so there is one command and
 * one rollback.
 *
 * ## The three things that are easy to get wrong
 *
 * - **The routes with no authorizer are not public by accident.** The two
 *   catalog routes, all of `/v1` and the OAuth token endpoint carry none, and
 *   each of those handlers resolves the caller itself. The one route that can
 *   never take an authorizer is `/v1`: it accepts a credential from either of two
 *   headers, and API Gateway validates every header named as an `identitySource`
 *   on *every* request — so an authorizer there would demand both and refuse
 *   every real caller. The reasoning is written out at length in
 *   `docs/workspace.md`.
 * - **The gateway's own responses need CORS headers.** A 401 from the authorizer
 *   is generated before any Lambda runs, so it carries none of the headers
 *   `lib/http` puts on ours — and a browser reports an opaque network failure
 *   where the answer it needed was a 401.
 * - **The execution role is shared by all of them**, as it was before. The grants
 *   are derived from the table objects rather than listed as ARNs, which is the
 *   point of the move: a missing `${Table.Arn}/index/*` used to be a runtime 500,
 *   because querying a global secondary index is a `Query` against the *index*.
 *   Narrowing these per function is a change to make deliberately, later; the
 *   migration deliberately did not, because a permission that is missing shows up
 *   as a 500 immediately and one that is too wide does not.
 */
export class PlayApiStack extends Stack {
  public readonly api: apigateway.CfnRestApi;
  /** The per-group nested stacks, in the order they were planned. */
  public readonly routeStacks: ApiRoutesStack[];

  constructor(scope: Construct, id: string, props: PlayApiStackProps) {
    super(scope, id, props);

    const { config, tables, media, auth } = props;

    // The bucket, imported here rather than taken from the media stack — see the
    // note on `MediaRefs`. Importing by name is a string, so it adds no
    // dependency in either direction.
    const videosBucket = s3.Bucket.fromBucketName(this, 'VideosBucket', media.videosBucketName);

    const role = this.createExecutionRole(config, tables, videosBucket, media);

    // The REST API, as the L1 resource rather than the L2 construct.
    //
    // `apigateway.RestApi` refuses to synthesize a stack whose API contains no
    // methods — a sensible guard, and one that cannot be satisfied here, because
    // every method this API has is in a nested stack. Its check is a private
    // method, so it cannot be overridden either. The L1 has no such opinion, and
    // the two things the L2 would have done for us — the deployment and the stage
    // — are the two things that need doing *differently* anyway: they have to
    // come after four other stacks, and a deployment CDK places itself would be
    // created before the methods existed. A stage like that answers 403 for every
    // new route until something else happens to trigger a redeploy.
    //
    // What the L2 also does is manage the *account-wide* API Gateway CloudWatch
    // role. Not having it is the point: with it, whichever stack deploys first
    // owns a role every other stack in the account then has to agree with.
    this.api = new apigateway.CfnRestApi(this, 'ApiGatewayRestApi', {
      name: `play-api-${config.stage}`,
      description: `Play backend (${config.stage})`,
      // Edge-optimized, which is what the API this replaces is. Not the same
      // switch as REST-versus-HTTP: the proxy event shape is identical either
      // way, so changing that is a separate decision.
      endpointConfiguration: { types: ['EDGE'] },
    });

    // The Cognito authorizer, as the L1 resource rather than the L2 construct.
    //
    // `CognitoUserPoolsAuthorizer` exists to be *attached to methods*, and it
    // insists on being attached: its `restApiId` resolves lazily, and reading it
    // without an attachment throws. Every method that uses this authorizer is in
    // a nested stack, and there is no supported way to attach one authorizer to
    // methods spread across four stacks — the second attachment compares two
    // different token renderings of the same id and refuses.
    //
    // So the authorizer is declared where it belongs, once, and handed to each
    // group as an id. This is the resource Serverless generated, down to the name
    // and the five-minute cache.
    const authorizer = new apigateway.CfnAuthorizer(this, 'CognitoAuthorizer', {
      restApiId: this.api.ref,
      name: 'cognito-authorizer',
      type: 'COGNITO_USER_POOLS',
      providerArns: [auth.userPool.userPoolArn],
      // The standard `Authorization` header, which is the only header an
      // authorizer can be given — see the note on `/v1` above.
      identitySource: 'method.request.header.Authorization',
      authorizerResultTtlInSeconds: 300,
    });

    // The responses the gateway produces itself carry no CORS headers, so a
    // browser sees a network failure instead of the 401 it needed to read. This
    // is about the gateway's own answers; the per-route preflight is each group's
    // business.
    new apigateway.CfnGatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApiId: this.api.ref,
      responseType: 'DEFAULT_4XX',
      responseParameters: {
        'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
        'gatewayresponse.header.Access-Control-Allow-Headers':
          "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
      },
    });
    new apigateway.CfnGatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApiId: this.api.ref,
      responseType: 'DEFAULT_5XX',
      responseParameters: {
        'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
      },
    });

    const environment = serviceEnvironment(config, tables, media);

    // The functions with no HTTP route: one S3 notification and two EventBridge
    // rules. They live here rather than in a group because they are not routes,
    // and because the S3 notification has to sit in the same stack as the Lambda
    // it invokes — the bucket object is here.
    const functionsByKey = new Map<string, lambda.Function>();
    for (const spec of offlineFunctions()) {
      functionsByKey.set(spec.key, this.createFunction(config, spec, role, environment));
    }
    this.wireEventSources(config, functionsByKey, videosBucket);

    // The routes, in their groups. `planGroups` throws — at synth, in a second —
    // if a path root is unclaimed or claimed twice.
    this.routeStacks = planGroups().map(
      (plan) =>
        new ApiRoutesStack(this, `Api${plan.group.id}Routes`, {
          config,
          plan,
          restApiId: this.api.ref,
          rootResourceId: this.api.attrRootResourceId,
          authorizerId: authorizer.ref,
          role,
          environment,
          description: `${plan.group.id} routes - ${plan.group.description}`,
        }),
    );

    // One deployment, after every method in every group exists.
    //
    // `AWS::ApiGateway::Deployment` is a snapshot: CloudFormation creates a stage
    // pointing at whatever the API looked like when it ran. CDK orders it after
    // the methods *in its own stack*, and there are none of them here, so the
    // ordering is stated instead — one dependency per group.
    //
    // The fingerprint in the construct id is what makes a change to a *method*
    // reach the stage at all. Ordering alone is not enough: CloudFormation only
    // replaces a resource whose properties changed, and the deployment's own
    // properties — the API id and a description — do not change when a route
    // does. So the snapshot is left alone, the stage keeps serving it, and the
    // edit is simply not live. `AWS::ApiGateway::Deployment` has no `Triggers`
    // property to lean on, which is why CDK's own `Deployment` construct does the
    // same thing this does: it puts a hash of the API it deployed into the
    // resource's logical id, so a change produces a new resource.
    const deployment = new apigateway.CfnDeployment(this, `Deployment${apiFingerprint()}`, {
      restApiId: this.api.ref,
      description: `Play backend ${config.stage}`,
    });
    for (const stack of this.routeStacks) {
      deployment.node.addDependency(stack);
    }

    // Kept, so a bad deploy can be rolled back by pointing the stage at the
    // previous deployment rather than by redeploying everything.
    deployment.applyRemovalPolicy(RemovalPolicy.RETAIN);

    new apigateway.CfnStage(this, 'Stage', {
      restApiId: this.api.ref,
      deploymentId: deployment.ref,
      stageName: config.stage,
      description: `Play backend ${config.stage}`,
    });

    // The output `get-env.mjs` and the two apps' `.env.local` files are built
    // from. Same shape as before — no trailing slash — so nothing that reads it
    // has to change.
    new CfnOutput(this, 'ApiUrl', {
      description: 'REST API base URL',
      value: `https://${this.api.ref}.execute-api.${this.region}.amazonaws.com/${config.stage}`,
    });
  }

  /**
   * The shared execution role, with every grant derived from the resource it is
   * about.
   *
   * The table half is generated: `src/generated/service.ts` carries each table's
   * actions and whether its indexes were included, transcribed from the
   * hand-written policy this replaces. One statement per table, so narrowing one
   * is a local edit rather than surgery on a 49-ARN block.
   */
  private createExecutionRole(
    config: PlayConfig,
    tables: Record<string, dynamodb.ITable>,
    videosBucket: s3.IBucket,
    media: MediaRefs,
  ): iam.Role {
    const role = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `play-${config.stage}-api`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Shared execution role for every Play API function',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    for (const spec of TABLES) {
      const table = tables[spec.id];
      if (!table) {
        throw new Error(
          `Table ${spec.id} is in the generated service table but not in the data stack`,
        );
      }

      role.addToPolicy(
        new iam.PolicyStatement({
          actions: spec.actions,
          resources: spec.grantsIndexes
            ? [table.tableArn, `${table.tableArn}/index/*`]
            : [table.tableArn],
        }),
      );
    }

    // The videos bucket: read and write objects, list the bucket. Not the
    // bucket's own configuration — nothing here reconfigures it.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [videosBucket.bucketArn, videosBucket.arnForObjects('*')],
      }),
    );

    // The three media services. `Resource: '*'` on all three is not laziness:
    // MediaConvert's job ARNs contain an endpoint the account only learns from
    // `DescribeEndpoints`, and Translate has no resource-level permissions at
    // all. What these grants can *do* is bounded by the roles they are handed.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'mediaconvert:CreateJob',
          'mediaconvert:GetJob',
          'mediaconvert:DescribeEndpoints',
        ],
        resources: ['*'],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
        resources: ['*'],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ['translate:TranslateText'], resources: ['*'] }),
    );

    // Invitation and reward email. The condition, rather than a scoped ARN, is
    // what keeps this harmless when no sender is configured: an ARN built from
    // an empty identity name would not resolve, so a condition that matches
    // nothing is the way to leave the grant inert.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: ['*'],
        conditions: { StringEquals: { 'ses:FromAddress': config.mail.fromAddress } },
      }),
    );

    // Handing the two media roles to MediaConvert and Transcribe, which is what
    // lets a job run with an identity narrower than this one.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [media.mediaConvertRoleArn, media.transcribeRoleArn],
      }),
    );

    // The two parameters the handlers read at runtime — the signing key and the
    // id of the key it belongs to — named exactly rather than by wildcard: a role
    // that can read every parameter in the account can read every secret in the
    // account.
    //
    // No `kms:Decrypt` beside them, because both are encrypted with the
    // AWS-managed `aws/ssm` key (a plain `String` is encrypted at rest too). A
    // parameter moved to a customer-managed key needs that grant added here.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          parameterArn(this, config.cloudFrontPrivateKeyParam),
          parameterArn(this, config.cloudFrontPublicKeyIdParam),
          // The Stripe **publishable** key, which is the one secret-shaped value
          // here that is not a secret: it is what a browser loads Stripe.js
          // with, and the route that reads it hands it to the marketplace's card
          // form. Same reasoning as the two above — it is named exactly rather
          // than reached with a wildcard.
          parameterArn(this, config.stripePublishableKeyParam),
        ],
      }),
    );

    // **The Stripe credentials, for the half of a purchase that is a route.**
    //
    // `POST /spaces/{spaceId}/checkout` runs in *this* stack and pays with the
    // API key, while the webhook that records the payment runs in
    // `PlayPaymentStack` and verifies with the signing secret. The two are one
    // feature in two stacks, which is exactly how the first version of it shipped
    // with the grant only on the webhook's role and answered 500 on the first
    // real checkout: `not authorized to perform: secretsmanager:GetSecretValue`.
    //
    // Both roles are given the same statement — see `grants.ts` — because
    // `stripeCredentials` reads both values in one call whichever half asks.
    role.addToPolicy(stripeCredentialsGrant(this, config));

    // Bedrock, for writing quiz questions from a lesson.
    //
    // `Resource: '*'` is Bedrock's own doing: a model is not an ARN in the
    // caller's account — it is a model id, some of which are cross-region
    // inference profiles whose requests are served from another region
    // altogether — and the API offers no resource-level permission for
    // `InvokeModel`. What the grant can *do* is bounded by what the account has
    // been granted access to in the Bedrock console, which is where model access
    // is actually decided.
    //
    // `InvokeModel` covers models called with a request body of their own;
    // `Converse` — which is what `lib/quiz-generation` uses, so that the model id
    // is the only thing that differs between an Amazon, Anthropic or Meta model
    // — is authorized by `bedrock:InvokeModel` as well, and both are named
    // because a fallback to the model-specific API needs no infrastructure
    // change.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );

    // Publishing the event that starts a question generation.
    //
    // The default bus, named as the default bus rather than by ARN, because the
    // rule that consumes it is created in this same stack and an account's
    // default bus has a fixed ARN shape the region already decides.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [
          Arn.format({ service: 'events', resource: 'event-bus', resourceName: 'default' }, this),
        ],
      }),
    );

    return role;
  }

  /**
   * One route's function, or one event-driven function.
   *
   * The environment it is handed comes from `serviceEnvironment`, which is a
   * budget as much as a map — see that function for what may go in it.
   */
  private createFunction(
    config: PlayConfig,
    spec: FunctionSpec,
    role: iam.Role,
    environment: Record<string, string>,
  ): lambda.Function {
    const { code, handler } = bundle(spec.entry);
    const name = `play-${config.stage}-${spec.key}`;

    // **A migrated stage declares its log group; a new environment does not.**
    //
    // The declared one is named and `RETAIN`ed, so it survives a stack delete —
    // which is the point, because the logs outlive the infrastructure that
    // produced them. The cost lands on the *retry*: CloudFormation refuses to
    // create a log group whose name already exists, so a deploy that failed
    // halfway wedges every attempt after it with
    //
    //   Resource of type 'AWS::Logs::LogGroup' with identifier
    //   '/aws/lambda/play-<stage>-<function>' already exists.
    //
    // and the same happens when a stage is destroyed and rebuilt under the same
    // name. That is precisely when somebody wants a retry to work.
    //
    // Omitting the group loses nothing for a new environment: Lambda creates
    // `/aws/lambda/<function>` on the first invocation, and because
    // CloudFormation never learns about it, that group outlives the stack for
    // free — the same retention, without a resource that can collide.
    //
    // `dev` keeps the managed one. It already exists, and leaving it alone is
    // what makes this change a no-op there.
    const logGroup = ownsEverything(config)
      ? undefined
      : new logs.LogGroup(this, `${pascal(spec.key)}LogGroup`, {
          logGroupName: `/aws/lambda/${name}`,
          removalPolicy: RemovalPolicy.RETAIN,
        });

    return new lambda.Function(this, `${pascal(spec.key)}Function`, {
      functionName: name,
      description: spec.description ?? `${spec.key} - see src/generated/service.ts`,
      runtime: lambda.Runtime.NODEJS_22_X,
      code,
      handler,
      role,
      timeout: Duration.seconds(spec.timeout),
      memorySize: spec.memorySize,
      environment: { ...environment, ...spec.environment },
      ...(logGroup ? { logGroup } : {}),
    });
  }

  /**
   * The two event sources that are not HTTP.
   *
   * The S3 notification is the important one: `put-bucket-notification-configuration`
   * replaces a bucket's *whole* notification configuration, so this stack and the
   * legacy one cannot both own it. This one wins from the moment it is deployed —
   * and the legacy stack's copy has to be **retained** rather than deleted when
   * that stack goes, or it would take this configuration with it and uploads
   * would stop being processed. `infra/scripts/teardown-legacy-stack.sh` is where
   * that is handled.
   */
  private wireEventSources(
    config: PlayConfig,
    functions: Map<string, lambda.Function>,
    videosBucket: s3.IBucket,
  ): void {
    for (const spec of offlineFunctions()) {
      const fn = functions.get(spec.key);
      if (!fn) continue;

      for (const notification of spec.s3) {
        if (notification.bucket !== 'VideosBucket') {
          throw new Error(
            `${spec.key} is notified from S3 bucket '${notification.bucket}', which is not the ` +
              'videos bucket this stack knows how to wire',
          );
        }
        for (const event of notification.events) {
          videosBucket.addEventNotification(toS3EventType(event), new s3n.LambdaDestination(fn), {
            ...(notification.prefix ? { prefix: notification.prefix } : {}),
            ...(notification.suffix ? { suffix: notification.suffix } : {}),
          });
        }
      }

      for (const rule of spec.eventBridge) {
        new events.Rule(this, `${pascal(spec.key)}Rule`, {
          ruleName: `play-${config.stage}-${spec.key}`,
          description: `Drives ${spec.key} from ${rule.source.join(', ')}`,
          eventPattern: {
            source: rule.source,
            detailType: rule.detailType,
            ...(rule.detail ? { detail: rule.detail } : {}),
          },
          targets: [new targets.LambdaFunction(fn)],
        });
      }
    }
  }
}

/**
 * A fingerprint of everything that decides what this API serves.
 *
 * It exists for one reason: to name the `AWS::ApiGateway::Deployment` resource,
 * so that a change to the API produces a *new* deployment rather than an update
 * to one whose properties did not change. See the note at the deployment for why
 * that is necessary — in short, a deployment is a snapshot and CloudFormation
 * has no other way to know it is stale.
 *
 * It hashes the **source** of the files that shape the API rather than a summary
 * of the methods, and that is deliberate. A summary is a hand-maintained
 * invariant — "everything that changes the API is in this object" — and the
 * first time somebody adds a header or a status code without updating it, the
 * result is an edit that deploys successfully and has no effect. Which is a
 * failure this file has already had once: the CORS preflight's status code was
 * changed, the stack updated, and the stage went on answering 204 because the
 * deployment had no idea anything was different.
 *
 * The cost is that editing a comment in these files re-creates a deployment. It
 * takes a few seconds and cannot be wrong, which is the right way round.
 *
 * `aws-cdk-lib` is not included: a change there changes far more than one
 * resource, and pinning the deployment to it would redeploy the API on every
 * dependency bump.
 */
function apiFingerprint(): string {
  const sources = [
    'src/stacks/api-stack.ts',
    'src/stacks/api-routes-stack.ts',
    'src/stacks/api-groups.ts',
    'src/generated/service.ts',
    'src/types.ts',
  ];

  const hash = createHash('sha256');
  for (const source of sources) {
    hash.update(source);
    hash.update(fs.readFileSync(path.join(INFRA_ROOT, source)));
  }
  return hash.digest('hex').slice(0, 10);
}

/**
 * `s3:ObjectCreated:*` → the CDK event type, which is a closed enum.
 *
 * Mapped explicitly rather than derived, so that an event the service starts
 * using has to be understood here before it can be wired: a filter that silently
 * matched nothing would be an upload nobody processed.
 */
function toS3EventType(event: string): s3.EventType {
  const known: Record<string, s3.EventType> = {
    's3:ObjectCreated:*': s3.EventType.OBJECT_CREATED,
    's3:ObjectCreated:Put': s3.EventType.OBJECT_CREATED_PUT,
    's3:ObjectCreated:Post': s3.EventType.OBJECT_CREATED_POST,
    's3:ObjectCreated:Copy': s3.EventType.OBJECT_CREATED_COPY,
    's3:ObjectCreated:CompleteMultipartUpload':
      s3.EventType.OBJECT_CREATED_COMPLETE_MULTIPART_UPLOAD,
    's3:ObjectRemoved:*': s3.EventType.OBJECT_REMOVED,
    's3:ObjectRemoved:Delete': s3.EventType.OBJECT_REMOVED_DELETE,
  };

  const mapped = known[event];
  if (!mapped) {
    throw new Error(`Unmapped S3 event type '${event}' — add it to toS3EventType`);
  }
  return mapped;
}
