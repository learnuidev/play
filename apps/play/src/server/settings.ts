import fs from "node:fs";
import path from "node:path";

import type {
  EnvironmentSettings,
  EnvironmentSettingsInput,
  GoogleOAuthValues,
} from "@/lib/types";
import { awsJson } from "./aws";
import { configFile, consoleDefaults, ownershipOf, readConfig, stageOutputs } from "./environments";

/**
 * The settings a person supplies for an environment, rather than discovers.
 *
 * Everything else in `infra/config/play-<stage>.json` is either a physical name
 * discovered from AWS or a resource count. These are the handful of values that
 * describe *this deployment of the product* and cannot be looked up:
 *
 * - the Google OAuth client id, its secret, and the URLs Cognito will accept;
 * - the address invitations come from and the two app base URLs.
 *
 * They are the values a new environment needs before it can deploy, because its
 * user pool is created from them. On `dev` they describe a pool that already
 * exists — nothing here redeploys it, and `set-auth-urls.mjs` is still what
 * changes the live pool.
 *
 * ## The secret never touches the config file
 *
 * The config file is committed. `googleClientSecret` is write-only: it is sent
 * to Secrets Manager and never read back, never echoed, and never written to
 * disk in the repository. `readSettings` reports only whether one is stored.
 *
 * Secrets Manager rather than SSM because CloudFormation refuses an SSM Secure
 * reference in `AWS::Cognito::UserPoolIdentityProvider` — see
 * `infra/src/stacks/auth-stack.ts`.
 */

/** The secret name for a stage. Mirrors `googleClientSecretName` in `infra/src/config.ts`. */
export function googleClientSecretName(stage: string): string {
  return `play/${stage}/google-client-secret`;
}

const EMPTY = { fromAddress: "", appBaseUrl: "", marketplaceBaseUrl: "" };

/** The settings on disk, with the defaults an absent block would have. */
export function readSettings(stage: string): EnvironmentSettings | null {
  const config = readConfig(stage);
  if (!config) return null;

  const ownership = ownershipOf(config);
  return {
    stage,
    configPath: configFile(stage),
    ownership,
    // A secret is only *needed* when this environment creates the pool. On an
    // imported pool the provider is already attached and no deploy reads it.
    needsGoogleSecret: ownership.auth,
    googleClientSecretName: googleClientSecretName(stage),
    googleClientSecretSet: false,
    auth: {
      googleClientId: config.auth?.googleClientId ?? "",
      callbackUrls: config.auth?.callbackUrls ?? [],
      logoutUrls: config.auth?.logoutUrls ?? [],
    },
    mail: {
      fromAddress: config.mail?.fromAddress ?? EMPTY.fromAddress,
      appBaseUrl: config.mail?.appBaseUrl ?? EMPTY.appBaseUrl,
      marketplaceBaseUrl: config.mail?.marketplaceBaseUrl ?? EMPTY.marketplaceBaseUrl,
    },
    // Filled in by the route, which is where the auth stack gets read.
    oauth: { cognitoDomain: null, javaScriptOrigin: null, redirectUri: null },
  };
}

/** Whether a Secrets Manager secret with this name exists and has a value. */
export async function googleSecretStatus(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<boolean> {
  const name = googleClientSecretName(stage);
  const found = await awsJson<{ ARN: string }>(
    ["secretsmanager", "describe-secret", "--secret-id", name],
    { ...ctx, optional: true },
  ).catch(() => null);
  return Boolean(found?.ARN);
}

/**
 * The values Google has to be told, or Google refuses every sign-in.
 *
 * A federated sign-in is a conversation between three parties, and this is the
 * half of it that lives in the Google Cloud console rather than here: Google
 * will not send anybody to a Cognito domain it has not been told about, and the
 * failure is `redirect_uri_mismatch` — a Google-branded error page that names
 * neither this repository nor this file.
 *
 * - **Authorized JavaScript origins** — the Hosted UI's origin.
 * - **Authorized redirect URIs** — Cognito's own callback, `/oauth2/idpresponse`,
 *   which is where Google returns to and Cognito then maps onto the app's
 *   `callbackUrls` above. These are two different lists and both have to be
 *   right: these say where Google may send a user, `callbackUrls` says where
 *   Cognito may send one afterwards.
 *
 * The domain is read from the deployed auth stack when there is one, because
 * that is the only place it is authoritative — an imported pool's domain was
 * chosen years ago and does not follow any rule this repository can re-derive.
 * Before the first deploy there is no stack, so it is derived the way the auth
 * stack will build it: `play-<stage>-<account>`.
 */
export async function googleOAuthValues(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<GoogleOAuthValues> {
  const config = readConfig(stage);
  const outputs = await stageOutputs(stage, ctx).catch(() => null);

  // Two shapes of the same thing, normalised to the full hostname: the stack
  // output already includes `.amazoncognito.com` because CDK returns the
  // distribution's domain, while a config file names only the pool's *prefix*.
  // Appending unconditionally is how this becomes
  // `…amazoncognito.com.amazoncognito.com`, which Google accepts as a valid
  // origin and then never matches.
  const host = outputs?.cognitoDomain
    ? outputs.cognitoDomain
    : config?.existing?.userPoolDomain
      ? `${config.existing.userPoolDomain}.auth.${config.region}.amazoncognito.com`
      : config?.account
        ? `play-${stage}-${config.account}.auth.${config.region}.amazoncognito.com`
        : null;

  if (!host) return { cognitoDomain: null, javaScriptOrigin: null, redirectUri: null };
  return {
    cognitoDomain: host,
    javaScriptOrigin: `https://${host}`,
    // Cognito's fixed path for an identity provider's response. Not configurable,
    // and the trailing part is spelled exactly like this.
    redirectUri: `https://${host}/oauth2/idpresponse`,
  };
}

/**
 * Writes the settings for an environment.
 *
 * Two destinations, deliberately kept apart: the configuration goes into the
 * committed config file, and the secret goes to Secrets Manager. Nothing else
 * in the file is touched — it is read, the two blocks are replaced, and it is
 * written back — so a field this view does not know about survives a save.
 */
export async function saveSettings(
  stage: string,
  input: EnvironmentSettingsInput,
  ctx: { profile?: string; region?: string } = {},
): Promise<EnvironmentSettings> {
  const file = configFile(stage);
  const before = readConfig(stage);
  if (!before) {
    throw new Error(
      `There is no infra/config/play-${stage}.json yet. Deploy ${stage} once — its third step ` +
        "writes the file — and then set these values.",
    );
  }

  const auth = {
    googleClientId: input.auth.googleClientId.trim(),
    callbackUrls: clean(input.auth.callbackUrls),
    logoutUrls: clean(input.auth.logoutUrls),
  };
  const mail = {
    fromAddress: input.mail.fromAddress.trim(),
    appBaseUrl: input.mail.appBaseUrl.trim(),
    marketplaceBaseUrl: input.mail.marketplaceBaseUrl.trim(),
  };

  const problems = validate({ auth, mail, secret: input.googleClientSecret });
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const next = { ...before, auth, mail } as Record<string, unknown>;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);

  if (input.googleClientSecret) {
    await writeGoogleSecret(stage, input.googleClientSecret, ctx);
  }

  const settings = readSettings(stage);
  if (!settings) throw new Error(`Wrote ${file}, but it could not be read back.`);
  settings.googleClientSecretSet = await googleSecretStatus(stage, ctx);
  settings.oauth = await googleOAuthValues(stage, ctx);
  return settings;
}

/**
 * Create the secret, or replace its value.
 *
 * `create-secret` and `put-secret-value` rather than `put-secret-value` alone,
 * because the first save for an environment has nothing to put to. Not
 * `update-secret`, which is for metadata and would leave a fresh secret with no
 * value at all — and a secret with no value is one CloudFormation resolves to
 * an empty string, which Google then rejects at the first sign-in rather than at
 * the deploy.
 */
async function writeGoogleSecret(
  stage: string,
  value: string,
  ctx: { profile?: string; region?: string },
): Promise<void> {
  const name = googleClientSecretName(stage);
  const exists = await googleSecretStatus(stage, ctx);

  const argv = exists
    ? ["secretsmanager", "put-secret-value", "--secret-id", name, "--secret-string", value]
    : [
        "secretsmanager",
        "create-secret",
        "--name",
        name,
        "--description",
        `Google OAuth client secret for the ${stage} environment`,
        "--secret-string",
        value,
      ];

  await awsJson(argv, ctx);
}

/**
 * The checks worth making before any of this reaches AWS.
 *
 * Each one is a value that is *accepted* by the config file and then fails much
 * later and much less clearly: a malformed callback URL is rejected by Cognito
 * during a rollback of the auth stack, and a client id without a secret is a
 * provider that cannot complete a sign-in.
 */
function validate(input: {
  auth: { googleClientId: string; callbackUrls: string[]; logoutUrls: string[] };
  mail: { fromAddress: string; appBaseUrl: string; marketplaceBaseUrl: string };
  secret?: string;
}): string[] {
  const problems: string[] = [];
  const { auth, mail, secret } = input;

  if (auth.googleClientId && !auth.googleClientId.endsWith(".apps.googleusercontent.com")) {
    problems.push(
      `"${auth.googleClientId}" does not look like a Google OAuth client id — they end in .apps.googleusercontent.com.`,
    );
  }
  if (secret && !auth.googleClientId) {
    problems.push("A Google client secret needs a client id to go with it.");
  }

  for (const [label, urls] of [
    ["Callback", auth.callbackUrls],
    ["Logout", auth.logoutUrls],
  ] as const) {
    for (const url of urls) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        problems.push(`${label} URL "${url}" is not a valid URL.`);
        continue;
      }
      // Cognito accepts http for localhost and requires https everywhere else.
      const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
        problems.push(`${label} URL "${url}" must be https, or http on localhost.`);
      }
    }
  }

  if (mail.fromAddress && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.fromAddress)) {
    problems.push(`"${mail.fromAddress}" is not a valid email address.`);
  }

  return problems;
}

/** Trim, drop blanks, and drop duplicates — a URL list is a set to Cognito. */
function clean(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function settingsContext() {
  const { profile, region } = consoleDefaults();
  return { profile, region };
}
