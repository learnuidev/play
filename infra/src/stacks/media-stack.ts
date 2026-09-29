import { Arn, CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

import type { PlayConfig } from '../config';
import { importedResources } from '../config';

export interface PlayMediaStackProps extends StackProps {
  config: PlayConfig;
}

/**
 * Where the video comes from: the bucket, the distribution that serves it, and
 * the two roles that transcode and transcribe into it.
 *
 * `ownership.media` decides what happens to the bucket and the distribution:
 *
 * - **`true` — a new environment — creates them**, named `play-<stage>-videos`
 *   and with a distribution of its own. Empty, and nobody else's.
 * - **`false` — `dev` — imports them** by physical name. They hold every
 *   uploaded and processed video, and a CloudFront distribution that is
 *   recreated is a distribution with a *new domain name*, which is a new URL in
 *   every player in the product.
 *
 * The two IAM roles are created either way, because a role has no state: a new
 * ARN is a new ARN, and the Lambdas read it from their environment.
 *
 * ## The bucket policy is the one resource managed twice — on a migrated stage
 *
 * CloudFront reaches the bucket through an origin access control, which the
 * bucket has to allow — so a bucket policy is part of serving video at all. It
 * lives here, and until the legacy stack is gone it also lives there, with the
 * same document. Both are a `PutBucketPolicy` of identical content, so the
 * duplication is inert; what is *not* inert is deleting the legacy stack
 * without care, because CloudFormation would delete the policy with it and
 * CloudFront would stop being able to read the bucket.
 *
 * `infra/scripts/teardown-legacy-stack.sh` is the answer: it deletes the stack
 * with `--retain-resources` naming this policy, so the policy is never removed
 * and the copy declared here simply carries on.
 */
export class PlayMediaStack extends Stack {
  public readonly videosBucket: s3.IBucket;
  /** The distribution's domain, which every stream URL is built against. */
  public readonly distribution: cloudfront.IDistribution;
  /** The CloudFront public key's id — the `CLOUDFRONT_KEY_PAIR_ID` handlers sign with. */
  public readonly publicKeyId: string;
  /** Assumed by MediaConvert to read the upload and write the ladder. */
  public readonly mediaConvertRole: iam.Role;
  /** Assumed by Transcribe to read the upload and write the subtitles. */
  public readonly transcribeRole: iam.Role;

  constructor(scope: Construct, id: string, props: PlayMediaStackProps) {
    super(scope, id, props);

    const { config } = props;
    const owned = config.ownership.media;

    this.videosBucket = owned
      ? new s3.Bucket(this, 'VideosBucket', {
          bucketName: `play-${config.stage}-videos`,
          // Uploads arrive from the browser by presigned PUT, from MediaConvert
          // and Transcribe as service writes, and are read back by CloudFront.
          // Nothing about that needs public access, so it is blocked four ways.
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          encryption: s3.BucketEncryption.S3_MANAGED,
          // Suspended rather than off or enabled: the product has never had
          // object versioning, and turning it on now would start retaining
          // every transcoded ladder forever.
          versioned: false,
          cors: [
            {
              allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
              allowedOrigins: ['*'],
              allowedHeaders: ['*'],
              exposedHeaders: ['ETag'],
            },
          ],
          removalPolicy: RemovalPolicy.RETAIN,
        })
      : s3.Bucket.fromBucketName(this, 'VideosBucket', importedResources(config).videosBucket);

    if (owned) {
      const created = this.createDistribution(config);
      this.distribution = created.distribution;
      this.publicKeyId = created.publicKeyId;
    } else {
      const existing = importedResources(config);
      this.distribution = cloudfront.Distribution.fromDistributionAttributes(
        this,
        'VideoDistribution',
        {
          domainName: existing.cloudFrontDomain,
          distributionId: existing.cloudFrontDistributionId,
        },
      );
      // The key pair id is a bare string here, like the name of a table: it is a
      // CloudFront-assigned identifier of a resource this stack does not manage,
      // and there is no construct to import it into.
      this.publicKeyId = existing.cloudFrontPublicKeyId;
    }

    // CloudFront's read of the bucket.
    //
    // **Imported mode only.** An unmanaged bucket cannot be given a policy by
    // the origin construct, so the document is declared here — and the same
    // document also lives in the legacy stack while that still exists, which is
    // the duplication the note above is about. Both are a `PutBucketPolicy` of
    // identical content, so it is inert.
    //
    // In the owned mode `S3BucketOrigin.withOriginAccessControl` attaches an
    // equivalent, distribution-scoped policy itself, and declaring a second one
    // is two `AWS::S3::BucketPolicy` resources against one bucket — which
    // CloudFormation rejects, so this is a deploy that does not happen rather
    // than a policy that is merely redundant.
    if (!owned) {
      const bucketPolicy = new s3.BucketPolicy(this, 'VideosBucketPolicy', {
        bucket: this.videosBucket,
        document: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowCloudFrontServicePrincipalReadOnly',
              effect: iam.Effect.ALLOW,
              principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
              actions: ['s3:GetObject'],
              resources: [this.videosBucket.arnForObjects('*')],
              conditions: {
                StringEquals: {
                  'AWS:SourceArn': Arn.format(
                    {
                      service: 'cloudfront',
                      region: '',
                      resource: 'distribution',
                      resourceName: this.distribution.distributionId,
                    },
                    this,
                  ),
                },
              },
            }),
          ],
        }),
      });

      // Retained, and it is the only resource in this app that is.
      //
      // Deleting the stack deletes the policy it created, and this policy is not
      // configuration — it is *how CloudFront is allowed to read the bucket*. Its
      // absence is not an error anywhere; it is every video in the product
      // returning 403. So a stack delete leaves it behind, and re-deploying the
      // stack is what would bring it back under management.
      bucketPolicy.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }

    this.mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
      roleName: `play-${config.stage}-mediaconvert`,
      assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
      description: 'Reads an upload from the videos bucket and writes the transcoded ladder back',
      inlinePolicies: {
        MediaConvertS3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [
                this.videosBucket.bucketArn,
                this.videosBucket.arnForObjects('uploads/*'),
              ],
            }),
            new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
              resources: [
                this.videosBucket.bucketArn,
                this.videosBucket.arnForObjects('processed/*'),
              ],
            }),
            // The frame-capture job writes the default thumbnail — the video's
            // first frame — here.
            new iam.PolicyStatement({
              actions: ['s3:PutObject'],
              resources: [this.videosBucket.arnForObjects('thumbnails/*')],
            }),
          ],
        }),
      },
    });

    this.transcribeRole = new iam.Role(this, 'TranscribeRole', {
      roleName: `play-${config.stage}-transcribe`,
      assumedBy: new iam.ServicePrincipal('transcribe.amazonaws.com'),
      description: 'Reads an upload and writes the transcript the subtitle pass then formats',
      inlinePolicies: {
        TranscribeS3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [
                this.videosBucket.bucketArn,
                this.videosBucket.arnForObjects('uploads/*'),
              ],
            }),
            new iam.PolicyStatement({
              actions: ['s3:PutObject'],
              resources: [this.videosBucket.arnForObjects('subtitles/*')],
            }),
          ],
        }),
      },
    });

    // `get-env.mjs` and the maintenance scripts read these rather than deriving
    // them, because a bucket name has a random suffix CloudFormation chose.
    new CfnOutput(this, 'CloudFrontDomain', {
      description: 'CloudFront distribution domain',
      value: this.distribution.distributionDomainName,
    });
    new CfnOutput(this, 'VideosBucketName', {
      description: 'S3 bucket name',
      value: this.videosBucket.bucketName,
    });
  }

  /**
   * The distribution, for the day this stack owns the media instead of
   * importing it.
   *
   * Every value here is the one the deployed distribution has: the CachingOptimized
   * managed policy id, `PriceClass_100`, the two behaviours, and a key group
   * gating both of them so that only a signed URL plays anything.
   */
  private createDistribution(config: PlayConfig): {
    distribution: cloudfront.Distribution;
    publicKeyId: string;
  } {
    const logsBucket = new s3.Bucket(this, 'CloudFrontLogsBucket', {
      bucketName: `play-${config.stage}-cloudfront-logs`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // The public half of the signing key pair. The private half is never here:
    // it lives in SSM and the handlers read it by name, which is what keeps a
    // 2.3 KB private key out of a hundred Lambdas' environments.
    const publicKey = new cloudfront.PublicKey(this, 'VideoPublicKey', {
      publicKeyName: `play-videos-public-key-${config.stage}`,
      encodedKey: ssm.StringParameter.valueForStringParameter(
        this,
        config.cloudFrontPublicKeyParam,
      ),
    });

    const keyGroup = new cloudfront.KeyGroup(this, 'VideoKeyGroup', {
      keyGroupName: `play-videos-key-group-${config.stage}`,
      items: [publicKey],
    });

    // The OAC is deliberately *not* declared here. `withOriginAccessControl`
    // creates one and attaches a bucket policy scoped to this distribution,
    // which is the whole of what CloudFront needs to read the bucket — and a
    // second `CfnOriginAccessControl` beside it is an unused resource, not a
    // belt-and-braces.
    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.videosBucket);

    const distribution = new cloudfront.Distribution(this, 'VideoDistribution', {
      comment: 'Play video streaming distribution',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableLogging: true,
      logBucket: logsBucket,
      logFilePrefix: 'cloudfront/',
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        trustedKeyGroups: [keyGroup],
      },
      additionalBehaviors: {
        '/processed/*': {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          compress: true,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          trustedKeyGroups: [keyGroup],
        },
      },
    });

    return { distribution, publicKeyId: publicKey.publicKeyId };
  }
}
