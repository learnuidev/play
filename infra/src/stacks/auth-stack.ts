import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

import { bundle } from '../bundling';
import type { PlayConfig } from '../config';
import { FUNCTIONS } from '../generated/service';

export interface PlayAuthStackProps extends StackProps {
  config: PlayConfig;
}

/**
 * The user pool both apps sign in to, and the one Lambda that Cognito calls.
 *
 * ## Everything here except the trigger is imported
 *
 * The pool, its app client and its domain already exist, and the pool is the
 * single most expensive thing in this account to recreate: deleting it takes
 * every account with it, including the federated ones, and there is no copy of
 * them anywhere. The app client's id is compiled into both frontends'
 * environments, so recreating the *client* is a redeploy of both apps and a
 * re-registration of every deployed origin. So all three are imported, and the
 * imports are why the pool's app client is read from
 * `infra/config/play-<stage>.json` rather than managed:
 *
 * > An imported resource is unmanaged. CDK will not change its properties and
 * > will not delete it.
 *
 * The practical consequence is that the callback URLs Cognito accepts are **not**
 * deployed from here. `services/api/scripts/set-auth-urls.sh` used to write an
 * SSM parameter and tell you to redeploy, because the pool was Serverless's to
 * update; it now calls Cognito directly, which is both fewer steps and the only
 * thing that can work.
 *
 * ## The trigger Lambda, and why it lives here
 *
 * `link-federated-user` is a pre sign-up trigger: it runs on a first federated
 * sign-in to attach that identity to the password account with the same verified
 * email, so Google and a password are one person rather than two. It is here
 * rather than in the API stack because the user pool references it, and the API
 * stack already references the user pool for its authorizer — putting it in the
 * API stack would close that into a dependency cycle.
 *
 * It is deployed in both modes, so its ARN is available either way. In the
 * imported mode nothing wires it to the pool — an imported pool's `LambdaConfig`
 * cannot be set from CDK — and `infra/scripts/adopt-cognito.sh` is what points
 * the pool at it, once, during the cutover.
 */
export class PlayAuthStack extends Stack {
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClientId: string;
  public readonly userPoolDomain: string;
  public readonly googleSignInEnabled: boolean;
  /** The pre sign-up trigger, whose ARN the pool has to be pointed at. */
  public readonly linkFederatedUserFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: PlayAuthStackProps) {
    super(scope, id, props);

    const { config } = props;
    const owned = config.ownership.auth;

    this.googleSignInEnabled = owned
      ? Boolean(config.auth.googleClientId)
      : config.existing.googleSignInEnabled;

    this.linkFederatedUserFunction = this.createTrigger(config);

    if (owned) {
      const created = this.createUserPool(config);
      this.userPool = created.userPool;
      this.userPoolClientId = created.clientId;
      this.userPoolDomain = created.domain;
    } else {
      this.userPool = cognito.UserPool.fromUserPoolId(
        this,
        'CognitoUserPool',
        config.existing.userPoolId,
      );
      this.userPoolClientId = config.existing.userPoolClientId;
      this.userPoolDomain = config.existing.userPoolDomain;
    }

    // Lets Cognito invoke the trigger above. This is a permission *about* the
    // function rather than a property of the pool, so it is the one part of the
    // trigger wiring that survives an imported pool.
    new lambda.CfnPermission(this, 'LinkFederatedUserInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: this.linkFederatedUserFunction.functionName,
      principal: 'cognito-idp.amazonaws.com',
      sourceArn: this.userPool.userPoolArn,
    });

    new CfnOutput(this, 'CognitoUserPoolId', {
      description: 'Cognito user pool id',
      value: this.userPool.userPoolId,
    });
    new CfnOutput(this, 'CognitoUserPoolClientId', {
      description: 'Cognito app client id',
      value: this.userPoolClientId,
    });
    new CfnOutput(this, 'CognitoDomain', {
      description: 'Cognito Hosted UI domain (empty when Google sign-in is not configured)',
      value: this.userPoolDomain ? `${this.userPoolDomain}.auth.${this.region}.amazoncognito.com` : '',
    });
    new CfnOutput(this, 'GoogleAuthEnabled', {
      description: 'Whether a Google identity provider is attached to this user pool',
      value: String(this.googleSignInEnabled),
    });
    new CfnOutput(this, 'LinkFederatedUserFunctionArn', {
      description: 'Pre sign-up trigger - the pool has to be pointed at this (scripts/adopt-cognito.sh)',
      value: this.linkFederatedUserFunction.functionArn,
    });
  }

  /**
   * The pre sign-up trigger.
   *
   * Its own execution role, deliberately: `AdminLinkProviderForUser` can attach
   * an external identity to *any* local account, so the only function that has
   * it is the one whose entire job is to do that safely. That is also why it is
   * not folded into the API stack's shared role.
   *
   * The `cognito-idp` resource is an ARN pattern rather than this pool's ARN.
   * In the owned mode that looks redundant — the pool is right here — but the
   * pattern is what keeps the role usable in the imported mode too, where the
   * pool's ARN comes from another construct. The handler only ever needs the
   * pool id, which arrives in its trigger event.
   */
  private createTrigger(config: PlayConfig): lambda.Function {
    const spec = FUNCTIONS.find((candidate) => candidate.key === 'link-federated-user');
    if (!spec) {
      throw new Error('link-federated-user is not in the generated function table');
    }

    const role = new iam.Role(this, 'LinkFederatedUserRole', {
      roleName: `play-${config.stage}-link-federated-user`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        LinkFederatedUser: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['cognito-idp:AdminLinkProviderForUser', 'cognito-idp:ListUsers'],
              resources: [
                Stack.of(this).formatArn({ service: 'cognito-idp', resource: 'userpool', resourceName: '*' }),
              ],
            }),
          ],
        }),
      },
    });

    const { code, handler } = bundle(spec.entry);

    return new lambda.Function(this, 'LinkFederatedUserFunction', {
      functionName: `play-${config.stage}-${spec.key}`,
      description: spec.description,
      runtime: lambda.Runtime.NODEJS_22_X,
      code,
      handler,
      role,
      timeout: Duration.seconds(spec.timeout),
      memorySize: spec.memorySize,
      logGroup: new logs.LogGroup(this, 'LinkFederatedUserLogGroup', {
        logGroupName: `/aws/lambda/play-${config.stage}-${spec.key}`,
        // Kept when the stack goes, like every other log group here: the logs
        // outlive the infrastructure that produced them, and a stack delete is
        // not a reason to lose the record of what happened.
        removalPolicy: RemovalPolicy.RETAIN,
      }),
    });
  }

  /**
   * The pool, for the day this stack owns auth instead of importing it — which
   * `docs/migration.md` phase E calls the last thing to move, and the reason is
   * that recreating this means every account re-registering.
   */
  private createUserPool(config: PlayConfig): {
    userPool: cognito.UserPool;
    clientId: string;
    domain: string;
  } {
    const userPool = new cognito.UserPool(this, 'CognitoUserPool', {
      userPoolName: `play-users-${config.stage}`,
      // Email as the username, verified automatically. Password accounts and
      // Google accounts both land on the same `sub` because this is what the
      // pre sign-up trigger matches on.
      signInAliases: { email: true },
      autoVerify: { email: true },
      selfSignUpEnabled: true,
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      standardAttributes: { email: { required: true, mutable: true } },
      // Only attached when Google is configured — the trigger is what makes a
      // federated sign-in reuse an existing password account.
      lambdaTriggers: this.googleSignInEnabled
        ? { preSignUp: this.linkFederatedUserFunction }
        : undefined,
      // The pool holds every account in the product. Retain, always.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    if (this.googleSignInEnabled) {
      // The client secret is the one secret this path needs, and it is read as a
      // CloudFormation dynamic reference rather than looked up at synth: the
      // value is resolved by CloudFormation at deploy, so it is never in the
      // synthesized template, in `cdk.out`, or in this process.
      new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdentityProvider', {
        userPool,
        clientId: config.auth.googleClientId,
        clientSecretValue: SecretValue.ssmSecure('/play/auth/google-client-secret', '1'),
        scopes: ['email', 'profile', 'openid'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
          fullname: cognito.ProviderAttribute.GOOGLE_NAME,
          profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
        },
      });
    }

    // Cognito requires a domain for federated sign-in — it serves the Hosted UI
    // the frontend redirects to. Prefix domains share one namespace per region,
    // so the account id is what keeps the prefix collision-free.
    //
    // Classic pages, not managed login: managed login needs a branding style,
    // and Cognito does not apply one to an app client created outside the
    // console, so the newer pages render unbranded. The deployed domain is
    // classic, and this matches it.
    const domain = new cognito.UserPoolDomain(this, 'CognitoUserPoolDomain', {
      userPool,
      cognitoDomain: { domainPrefix: `play-${config.stage}-${this.account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.CLASSIC_HOSTED_UI,
    });

    const client = userPool.addClient('CognitoUserPoolClient', {
      userPoolClientName: `play-app-${config.stage}`,
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: config.auth.callbackUrls,
        logoutUrls: config.auth.logoutUrls,
      },
      supportedIdentityProviders: this.googleSignInEnabled
        ? [cognito.UserPoolClientIdentityProvider.COGNITO, cognito.UserPoolClientIdentityProvider.GOOGLE]
        : [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    return { userPool, clientId: client.userPoolClientId, domain: domain.domainName };
  }
}
