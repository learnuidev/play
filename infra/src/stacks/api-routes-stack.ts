import { Duration, NestedStack, type NestedStackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

import { bundle } from '../bundling';
import type { PlayConfig } from '../config';
import { pascal } from '../naming';
import type { GroupPlan } from './api-groups';

// Deployed strings here are ASCII, and that is a rule rather than a preference.
// An em-dash in a Lambda description — which is how the rest of this repository
// writes, in comments — comes back from CloudFormation's `GetTemplate` as `?`,
// so `cdk diff` reports every one of them as drift on every run and a deploy
// flips them back and forth forever. The resource itself gets the right
// character; it is the template read-back that does not round-trip it. A plain
// hyphen costs nothing and keeps `cdk diff` meaning "something actually
// changed".

/**
 * The headers a browser may send on a cross-origin call to this API.
 *
 * One list, used by every preflight, and it is the one the deployed API sends —
 * including `X-Amzn-Trace-Id`, which nothing in this repository sets and which
 * is here because it is in the response today and removing it is not this
 * migration's business.
 */
const ALLOW_HEADERS = [
  'Content-Type',
  'X-Amz-Date',
  'Authorization',
  'X-Api-Key',
  'X-Amz-Security-Token',
  'X-Amz-User-Agent',
  'X-Amzn-Trace-Id',
];

export interface ApiRoutesStackProps extends NestedStackProps {
  config: PlayConfig;
  plan: GroupPlan;
  /** The REST API, which lives in the parent stack. */
  restApiId: string;
  /** Its root resource — where this group's slice of the path tree begins. */
  rootResourceId: string;
  /** The Cognito authorizer, which also lives in the parent. */
  authorizerId: string;
  /** The shared execution role, which also lives in the parent. */
  role: iam.IRole;
  /** The environment every function in the API shares. */
  environment: Record<string, string>;
}

/**
 * One group of routes: the functions that serve them, their methods, and the
 * CORS preflights in front of them.
 *
 * A nested stack rather than a stack of its own, because all four groups are
 * one REST API. Splitting them into sibling stacks would mean four stacks
 * sharing a gateway through imported attributes and a fifth holding the
 * deployment that has to come after all of them — a dependency graph that
 * exists only to satisfy a resource limit, and that gets harder to read every
 * time somebody has to change it. A nested stack is a real CloudFormation stack
 * with its own 500-resource budget, reached through the parent, and
 * `cdk deploy PlayApiStack-dev` deploys all of it in the right order.
 *
 * What this stack does **not** own, and why: the API itself, the authorizer,
 * the gateway responses, the deployment and the execution role are all in the
 * parent. Everything here that touches one of them receives it as a parameter,
 * which is what keeps the four groups independent of each other — no group can
 * reference another group's resources, so no group can be half-deployed in a
 * way that breaks a neighbour.
 */
export class ApiRoutesStack extends NestedStack {
  constructor(scope: Construct, id: string, props: ApiRoutesStackProps) {
    super(scope, id, props);

    const { config, plan, restApiId, rootResourceId, authorizerId, role, environment } = props;

    // The API, as the parent's stack defines it. `fromRestApiAttributes` is the
    // supported way to add methods to an API that lives somewhere else, and it
    // is what makes this stack's `AWS::ApiGateway::Method` resources valid
    // without the `AWS::ApiGateway::RestApi` being here.
    const api = apigateway.RestApi.fromRestApiAttributes(this, 'RestApi', {
      restApiId,
      rootResourceId,
    });

    // The authorizer, narrowed to the two fields a method actually needs. It is
    // deliberately not an `IAuthorizer` construct from the parent: this stack
    // has no business holding one, and a plain object is the whole interface.
    const authorizer: apigateway.IAuthorizer = {
      authorizerId,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const resources = new Map<string, apigateway.IResource>();
    const resourceFor = (path: string): apigateway.IResource => {
      const existing = resources.get(path);
      if (existing) return existing;

      const segments = path.split('/');
      const parentPath = segments.slice(0, -1).join('/');
      const parent = parentPath ? resourceFor(parentPath) : api.root;
      const created = parent.addResource(segments[segments.length - 1]);
      resources.set(path, created);
      return created;
    };

    const methodsByPath = new Map<string, Set<string>>();

    for (const spec of plan.functions) {
      const fn = this.createFunction(config, spec, role, environment);

      for (const route of spec.http) {
        resourceFor(route.path).addMethod(
          route.method,
          new apigateway.LambdaIntegration(fn),
          route.authorized
            ? { authorizer }
            : { authorizationType: apigateway.AuthorizationType.NONE },
        );

        const methods = methodsByPath.get(route.path) ?? new Set<string>();
        methods.add(route.method);
        methodsByPath.set(route.path, methods);
      }
    }

    // One preflight per path, naming the methods that path actually has.
    //
    // Built by hand rather than with `resource.addCorsPreflight`, and the reason
    // is one line of CloudFormation that CDK does not emit. A MOCK integration
    // with no `ResponseTemplates` returns the mock's empty body straight
    // through, and API Gateway answers **204 No Content**. The deployed API
    // answers **200**, because Serverless wrote `"application/json": ""` — an
    // empty template, which is what turns "no body" into "a body that is empty".
    //
    // Both are valid CORS preflight answers and every current browser accepts
    // either, so this would be a defensible change to make — deliberately, on
    // its own, with the reason written down. It is not something to smuggle into
    // a migration that is otherwise trying to be a no-op. `addCorsPreflight`
    // takes a `statusCode` option, which is what makes the mistake easy: the
    // *method response* changes to 200 and the behaviour does not, because the
    // status the caller sees comes from the integration response.
    for (const [path, methods] of methodsByPath) {
      const allowMethods = `'OPTIONS,${[...methods].sort().join(',')}'`;
      const responseHeaders = {
        'method.response.header.Access-Control-Allow-Origin': "'*'",
        'method.response.header.Access-Control-Allow-Headers': `'${ALLOW_HEADERS.join(',')}'`,
        'method.response.header.Access-Control-Allow-Methods': allowMethods,
      };

      resourceFor(path).addMethod(
        'OPTIONS',
        new apigateway.MockIntegration({
          requestTemplates: { 'application/json': '{statusCode:200}' },
          contentHandling: apigateway.ContentHandling.CONVERT_TO_TEXT,
          integrationResponses: [
            {
              statusCode: '200',
              responseParameters: responseHeaders,
              // The empty template. Without it the caller gets 204.
              responseTemplates: { 'application/json': '' },
            },
          ],
        }),
        {
          authorizationType: apigateway.AuthorizationType.NONE,
          methodResponses: [
            {
              statusCode: '200',
              responseParameters: Object.fromEntries(
                Object.keys(responseHeaders).map((header) => [header, true]),
              ),
            },
          ],
        },
      );
    }
  }

  private createFunction(
    config: PlayConfig,
    spec: GroupPlan['functions'][number],
    role: iam.IRole,
    environment: Record<string, string>,
  ): lambda.Function {
    const { code, handler } = bundle(spec.entry);
    const name = `play-${config.stage}-${spec.key}`;

    return new lambda.Function(this, `${pascal(spec.key)}Function`, {
      // Named explicitly, and deliberately *not* the old
      // `play-backend-<stage>-<key>`: the two APIs run side by side during the
      // cutover, and a Lambda name is unique per account. The old name is
      // recoverable — the function keys in `src/generated/service.ts` are what
      // it was built from.
      functionName: name,
      description: spec.description ?? `${spec.key} - see src/generated/service.ts`,
      runtime: lambda.Runtime.NODEJS_22_X,
      code,
      handler,
      role,
      timeout: Duration.seconds(spec.timeout),
      memorySize: spec.memorySize,
      environment: { ...environment, ...spec.environment },
      logGroup: new logs.LogGroup(this, `${pascal(spec.key)}LogGroup`, {
        logGroupName: `/aws/lambda/${name}`,
        // Kept when the stack goes: the logs outlive the infrastructure that
        // produced them, and a stack delete is not a reason to lose them.
        removalPolicy: RemovalPolicy.RETAIN,
        // No retention period, which is what this service has always had. Worth
        // knowing rather than defaulting into: these log groups never expire,
        // and setting a retention is a real change to make on purpose.
      }),
    });
  }
}
