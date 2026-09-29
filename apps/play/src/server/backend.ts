import type { BackendEnvView, DeploymentEventView, DeploymentHistoryView, EnvRow } from "@/lib/types";
import { awsJson } from "./aws";
import { readConfig, stageOutputs } from "./environments";
import { googleSecretStatus, readSettings, settingsContext } from "./settings";

/**
 * A backend environment, described the two ways that matter: what you put in,
 * and what comes out.
 *
 * ## Inputs and outputs are not "variables"
 *
 * The interesting thing about this backend is that almost nothing it runs on is
 * typed in as an environment variable. It is two different directions:
 *
 * - **Inputs** are what a *person* supplies, because nothing can discover them:
 *   the Google OAuth client and its secret, the origins Cognito will accept, the
 *   address invitations come from. They are written by the Settings form and
 *   read by a deploy.
 * - **Outputs** are what the *deploy* produces — the API URL, the pool, its app
 *   client, the Hosted UI domain, the distribution — and they are consumed by
 *   something else entirely: the three frontends. They are the answer to "which
 *   environment is this app pointed at", and the reason a frontend's own view is
 *   just these rows with a different `usedBy`.
 *
 * Calling both of them "environment variables" would hide the only thing worth
 * knowing about either: which direction the value travels, and who reads it.
 */

/** The apps that consume each output, so the frontend view can be the same rows. */
export const CONSUMERS: Record<string, string[]> = {
  ApiUrl: ["studio", "marketplace", "demo"],
  CognitoUserPoolId: ["studio", "marketplace", "demo"],
  CognitoUserPoolClientId: ["studio", "marketplace", "demo"],
  CognitoDomain: ["studio", "marketplace", "demo"],
  GoogleAuthEnabled: ["studio", "marketplace", "demo"],
  CloudFrontDomain: ["videos"],
  VideosBucketName: ["process-video"],
};

/** The five values `docs/deploy.md` calls "the backend variables". */
export const FRONTEND_OUTPUTS = [
  "ApiUrl",
  "CognitoUserPoolId",
  "CognitoUserPoolClientId",
  "CognitoDomain",
  "GoogleAuthEnabled",
];

/** Output key → the `NEXT_PUBLIC_*` name a frontend receives it as. */
export const OUTPUT_ENV_NAME: Record<string, string> = {
  ApiUrl: "NEXT_PUBLIC_API_URL",
  CognitoUserPoolId: "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
  CognitoUserPoolClientId: "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  CognitoDomain: "NEXT_PUBLIC_COGNITO_DOMAIN",
  GoogleAuthEnabled: "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED",
};

export const OUTPUT_LABEL: Record<string, string> = {
  ApiUrl: "REST API base URL",
  CognitoUserPoolId: "Cognito user pool",
  CognitoUserPoolClientId: "Cognito app client",
  CognitoDomain: "Cognito Hosted UI domain",
  GoogleAuthEnabled: "Google sign-in enabled",
  CloudFrontDomain: "CloudFront distribution",
  VideosBucketName: "Videos bucket",
  LinkFederatedUserFunctionArn: "Pre sign-up trigger",
};

/**
 * What this environment reads, and what it produces.
 *
 * The inputs come from the config file and Secrets Manager; the outputs from the
 * two stacks that publish them. A missing output is a stage that has not
 * deployed, which is reported as a row with no value rather than as an absence —
 * the absence is the useful information.
 */
export async function backendEnv(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<BackendEnvView> {
  const config = readConfig(stage);
  const settings = readSettings(stage);
  const outputs = await stageOutputs(stage, ctx).catch(() => null);
  const secretSet = await googleSecretStatus(stage, ctx).catch(() => false);

  const ownership = settings?.ownership ?? { tables: false, media: false, auth: false };
  const createsPool = ownership.auth;

  const inputs: EnvRow[] = [
    {
      key: "Google client id",
      value: settings?.auth.googleClientId || null,
      source: "Settings — the OAuth client Cognito signs in with",
      editable: true,
      usedBy: createsPool ? ["the pool this environment creates"] : ["the pool this environment imports"],
    },
    {
      key: "Google client secret",
      value: null,
      source: secretSet
        ? `Secrets Manager — ${settings?.googleClientSecretName ?? ""}`
        : "not set — see Settings",
      secret: true,
      editable: true,
      usedBy: createsPool ? ["the identity provider"] : ["nothing (imported pool)"],
    },
    {
      key: "Callback URLs",
      value: settings?.auth.callbackUrls.join(", ") || null,
      source: "Settings — origins Cognito will return a sign-in to",
      editable: true,
      usedBy: ["studio", "marketplace"],
    },
    {
      key: "Logout URLs",
      value: settings?.auth.logoutUrls.join(", ") || null,
      source: "Settings — origins Cognito will return a sign-out to",
      editable: true,
      usedBy: ["studio", "marketplace"],
    },
    {
      key: "Mail from address",
      value: settings?.mail.fromAddress || null,
      source: "Settings — every Lambda's MAIL_FROM_ADDRESS",
      editable: true,
      usedBy: ["invitations"],
    },
    {
      key: "Studio base URL",
      value: settings?.mail.appBaseUrl || null,
      source: "Settings — APP_BASE_URL, the host in a mailed link",
      editable: true,
      usedBy: ["invitations"],
    },
    {
      key: "Marketplace base URL",
      value: settings?.mail.marketplaceBaseUrl || null,
      source: "Settings — MARKETPLACE_BASE_URL",
      editable: true,
      usedBy: ["invitations"],
    },
    {
      key: "CloudFront signing key",
      value: config?.cloudFrontPrivateKeyParam ?? null,
      source: "infra/config — the *name* of the SSM parameter, never the key",
      usedBy: ["signed video URLs"],
    },
  ];

  const merged = await stackOutputs(stage, ctx);
  const outputRows: EnvRow[] = OUTPUT_ORDER.map((key) => ({
    key,
    value: merged[key] ?? null,
    source: OUTPUT_LABEL[key] ?? key,
    usedBy: CONSUMERS[key] ?? [],
  }));

  return { stage, inputs, outputs: outputRows };
}

/** The order the outputs are shown in: what the frontends need, then the media. */
const OUTPUT_ORDER = [
  "ApiUrl",
  "CognitoUserPoolId",
  "CognitoUserPoolClientId",
  "CognitoDomain",
  "GoogleAuthEnabled",
  "CloudFrontDomain",
  "VideosBucketName",
  "LinkFederatedUserFunctionArn",
];

interface RawStack {
  Outputs?: Array<{ OutputKey?: string; OutputValue?: string }>;
}

/**
 * Every output of **this stage's** four root stacks.
 *
 * Four named reads rather than one unfiltered `describe-stacks`: that call
 * without a `--stack-name` returns every stack in the account, so `ApiUrl` from
 * `dev` would land in the staging row and the page would confidently report the
 * wrong API. Which is the one mistake a page about "which environment is this"
 * must not make.
 */
export async function stackOutputs(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<Record<string, string>> {
  const names = ["Data", "Media", "Auth", "Api"].map((suffix) => `Play${suffix}Stack-${stage}`);

  const stacks = await Promise.all(
    names.map((name) =>
      awsJson<RawStack[]>(
        ["cloudformation", "describe-stacks", "--stack-name", name, "--query", "Stacks"],
        { ...ctx, optional: true },
      ).catch(() => null),
    ),
  );

  const merged: Record<string, string> = {};
  for (const body of stacks) {
    for (const stack of body ?? []) {
      for (const output of stack.Outputs ?? []) {
        if (output.OutputKey && output.OutputValue !== undefined) {
          merged[output.OutputKey] = output.OutputValue;
        }
      }
    }
  }
  return merged;
}

interface RawEvent {
  Timestamp?: string;
  StackName?: string;
  ResourceStatus?: string;
  ResourceType?: string;
  LogicalResourceId?: string;
  ResourceStatusReason?: string;
}

/**
 * What has actually been deployed, from CloudFormation rather than from a log
 * this process keeps.
 *
 * CloudFormation is the record: it holds every create, update and rollback with
 * the reason, and it survives the console restarting, the repository moving and
 * the last run being forgotten. A deployment history kept on `globalThis` would
 * be a history that begins when you opened the page.
 */
export async function deploymentHistory(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
  limit = 40,
): Promise<DeploymentHistoryView> {
  const names = ["Data", "Media", "Auth", "Api"].map((suffix) => `Play${suffix}Stack-${stage}`);

  const results = await Promise.all(
    names.map((stackName) =>
      awsJson<RawEvent[]>(
        [
          "cloudformation",
          "describe-stack-events",
          "--stack-name",
          stackName,
          "--max-items",
          "30",
          "--query",
          "StackEvents",
        ],
        { ...ctx, optional: true },
      ).catch(() => null),
    ),
  );

  const events: DeploymentEventView[] = [];
  let missing = 0;

  results.forEach((batch, index) => {
    if (!batch) {
      missing += 1;
      return;
    }
    for (const event of batch) {
      events.push({
        at: event.Timestamp ? Date.parse(event.Timestamp) : 0,
        stack: names[index],
        status: event.ResourceStatus ?? "UNKNOWN",
        resource: event.LogicalResourceId ?? null,
        reason: event.ResourceStatusReason ?? null,
      });
    }
  });

  events.sort((a, b) => b.at - a.at);

  return {
    stage,
    events: events.slice(0, limit),
    note: missing
      ? `${missing} of the four root stacks do not exist in this environment yet.`
      : null,
  };
}

export function backendContext() {
  return settingsContext();
}
