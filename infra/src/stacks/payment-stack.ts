import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

import { bundle } from '../bundling';
import type { PlayConfig } from '../config';
import { ownsEverything } from '../config';
import { FUNCTIONS, TABLES } from '../generated/service';
import { serviceEnvironment, type ServiceEnvironmentInput } from './environment';
import { parameterArn, stripeCredentialsGrant } from './grants';

export interface PlayPaymentStackProps extends StackProps {
  config: PlayConfig;
  /** From the data stack, because the webhook is what writes a payment. */
  tables: Record<string, dynamodb.ITable>;
  media: ServiceEnvironmentInput;
}

/**
 * Taking money: the credential a deployment charges with, and the one endpoint
 * Stripe is allowed to call.
 *
 * ## What is here, and what is deliberately not
 *
 * **The credential is not a resource this stack creates.** `stripeSecretName`
 * and `stripePublishableKeyParam` name where a stage's Stripe values live, and
 * the console's Checklist tab is what puts them there — the same division the
 * Google client secret has, and for the same reason: a stack that created the
 * secret would own a value it did not know, and the console's write would then be
 * a fight with the next deploy rather than the way the value is set. What this
 * stack does is hand the *names* to the handler that reads them, which is the
 * whole of what a deploy needs to know about a credential.
 *
 * **The publishable key is a parameter, not a secret.** It is served to browsers
 * — it is what a marketplace page loads Stripe.js with — so it sits in SSM as a
 * plain `String` and a handler reads it with one `GetParameter` rather than a
 * `GetSecretValue` and a JSON parse. Putting it in the secret as well would make
 * the one value that is public the one value that costs a decryption to read.
 *
 * **The tables are not here either.** `PaymentsTable` and `PaymentMethodsTable`
 * are declared in the generated service table and created by `PlayDataStack`,
 * like every other table in this service, because what a change to a table costs
 * is not what a change to a webhook costs. This stack imports the ones it needs
 * and grants its function the DynamoDB actions the generated table declares.
 *
 * ## Why the webhook has its own function URL
 *
 * Because the caller is Stripe, and Stripe cannot present a Cognito token. The
 * alternative — a route on the REST API with no authorizer — would put a public
 * route on the gateway whose authentication is a header the gateway never looks
 * at, and would have to live in the API stack, whose routes are the product's own
 * surface. A function URL is one resource, it has the URL this stack publishes as
 * an output, and it is unauthenticated by construction: the request is
 * authenticated by its `Stripe-Signature` header, verified in the handler against
 * this environment's webhook signing secret, and a request that does not verify
 * is refused before the body is parsed.
 *
 * That also makes the endpoint's own URL the thing a person has to *paste into
 * Stripe*, which is why it is an output rather than something read off the
 * console: `StripeWebhookUrl` is what goes in the dashboard's endpoint box, and
 * the console's Checklist tab prints it beside the events to subscribe to.
 */
export class PlayPaymentStack extends Stack {
  /** The one endpoint Stripe is pointed at. */
  public readonly webhookUrl: string;
  /** The Lambda behind it, for the outputs a person reads. */
  public readonly webhookFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: PlayPaymentStackProps) {
    super(scope, id, props);

    const { config, tables, media } = props;

    this.webhookFunction = this.createWebhook(config, tables, media);
    this.webhookUrl = this.webhookFunction.addFunctionUrl({
      // Stripe is the caller and it has no AWS identity, so the URL itself
      // carries no authentication: the signature in the request is the
      // authentication, and the handler is where it is checked.
      authType: lambda.FunctionUrlAuthType.NONE,
    }).url;

    new CfnOutput(this, 'StripeWebhookUrl', {
      description: 'Paste this into the Stripe dashboard as a webhook endpoint',
      value: this.webhookUrl,
    });

    // The names rather than the values, on purpose: an output is readable by
    // anybody with `cloudformation:DescribeStacks` on this account, and a
    // credential in one would be a credential in a console page and in the
    // console's own state endpoint.
    new CfnOutput(this, 'StripeSecretName', {
      description: 'Secrets Manager secret holding the Stripe API key and webhook signing secret',
      value: config.stripeSecretName,
    });
    new CfnOutput(this, 'StripePublishableKeyParam', {
      description: 'SSM parameter holding the publishable key the frontends load Stripe.js with',
      value: config.stripePublishableKeyParam,
    });
  }

  /**
   * The webhook.
   *
   * Its own role rather than the API's shared one, for the reason the pre sign-up
   * trigger has one: it is not in the API stack, so it cannot be given that role,
   * and what it may touch is worth saying out loud anyway — one secret, one
   * parameter, and the three tables a payment and a saved card are written to.
   * Nothing here reads a video, signs a URL or sends mail.
   */
  private createWebhook(
    config: PlayConfig,
    tables: Record<string, dynamodb.ITable>,
    media: ServiceEnvironmentInput,
  ): lambda.Function {
    const spec = FUNCTIONS.find((candidate) => candidate.key === 'stripe-webhook');
    if (!spec) {
      throw new Error('stripe-webhook is not in the generated function table');
    }

    const { code, handler } = bundle(spec.entry);

    const payments = tables.PaymentsTable;
    const paymentMethods = tables.PaymentMethodsTable;
    const spaceMembers = tables.SpaceMembersTable;
    const spaces = tables.SpacesTable;
    for (const [id, table] of Object.entries({
      PaymentsTable: payments,
      PaymentMethodsTable: paymentMethods,
      SpaceMembersTable: spaceMembers,
      SpacesTable: spaces,
    })) {
      if (!table) {
        throw new Error(
          `${id} is not in the data stack, so the payment webhook cannot be granted it — ` +
            'the webhook records what was paid for, what card was saved and enrols the buyer, ' +
            'and every one of those is a write',
        );
      }
    }

    // Every table the handler's own libraries read, granted the actions the
    // generated service declares for each. `PaymentsTable` is this stack's
    // subject; `PaymentMethodsTable` is the other thing Stripe's events write —
    // a card saved in `mode=setup` arrives as the same completed checkout — and
    // the other two are what a paid enrolment is made of.
    const granted = ['PaymentsTable', 'PaymentMethodsTable', 'SpaceMembersTable', 'SpacesTable'];
    const statements = granted.map((id) => {
      const table = tables[id];
      const declared = TABLES.find((spec) => spec.id === id);
      if (!declared) {
        throw new Error(`${id} is not in the generated service table, so its actions are unknown`);
      }
      return new iam.PolicyStatement({
        actions: declared.actions,
        // The indexes are part of the grant whether or not this function reads
        // them: an index is a different resource as far as IAM is concerned, the
        // grants are derived from the table the generated service declares rather
        // than written out per caller, and a `${table.tableArn}/index/*` that is
        // missing is a 500 on one screen rather than anything a synth catches.
        resources: declared.grantsIndexes
          ? [table.tableArn, `${table.tableArn}/index/*`]
          : [table.tableArn],
      });
    });

    const role = new iam.Role(this, 'StripeWebhookRole', {
      roleName: `play-${config.stage}-stripe-webhook`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        StripeWebhook: new iam.PolicyDocument({ statements }),
      },
    });

    // The Stripe credentials, read by name at request time: the signing secret an
    // event is verified with, and the API key `stripeCredentials` reads beside it
    // in the same call. The statement is built in `grants.ts` and given to the API
    // stack's role as well, because the checkout route is the other half of this
    // feature and needs the same two secrets.
    role.addToPolicy(stripeCredentialsGrant(this, config));

    // The publishable key, which is not a secret and **is** read now: the
    // marketplace draws its card field with Stripe Elements, so the route that
    // opens that form hands the page this key to load Stripe.js with. The grant
    // is here because this is the stack that owns the Stripe side of the
    // deployment; the API stack's role has the same one, because that is where
    // the route runs.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [parameterArn(this, config.stripePublishableKeyParam)],
      }),
    );

    return new lambda.Function(this, 'StripeWebhookFunction', {
      functionName: `play-${config.stage}-${spec.key}`,
      description: spec.description,
      runtime: lambda.Runtime.NODEJS_22_X,
      code,
      handler,
      role,
      timeout: Duration.seconds(spec.timeout),
      memorySize: spec.memorySize,
      // The service's own environment, Stripe names included: they are not this
      // stack's secret to keep — the route that *creates* a checkout session
      // needs the same names and lives in the API stack — and none of them is a
      // value, so there is nothing here a Lambda console could show.
      environment: serviceEnvironment(config, tables, media),
      // Same rule as every other function here: a migrated stage declares its
      // retained log group, a new environment lets Lambda create one. See
      // `createFunction` in `api-stack.ts` for why that difference is real.
      ...(ownsEverything(config)
        ? {}
        : {
            logGroup: new logs.LogGroup(this, 'StripeWebhookLogGroup', {
              logGroupName: `/aws/lambda/play-${config.stage}-${spec.key}`,
              removalPolicy: RemovalPolicy.RETAIN,
            }),
          }),
    });
  }

}
