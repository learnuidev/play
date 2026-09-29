import type {
  EnvironmentSettings,
  EnvironmentSettingsInput,
  GoogleOAuthValues,
  SettingsWriteView,
} from "@/lib/types";
import { awsJson, getIdentity } from "./aws";
import {
  configFile,
  consoleDefaults,
  newStageConfig,
  ownershipOf,
  pickSeedStage,
  readConfig,
  stageOutputs,
  writeConfig,
} from "./environments";
import { ensureSigningKey } from "./signing-key";

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

/**
 * The settings on disk, with the defaults an absent block would have.
 *
 * **A stage with no config file gets a draft rather than null.** That is the
 * state a new environment is in before anything has been written, and it is
 * exactly when somebody has to supply the Google client id and secret: the pool
 * this environment will create is built from them. So the draft is the *seed's*
 * values — the product's mail addresses, its client id, its callback URLs —
 * under this stage's name, and the console shows it as a form with one thing
 * missing, which is the credential only a person has.
 *
 * Nothing about the seed's *data* is in it: not a table name, not a bucket, not
 * a pool. `hasConfig: false` is what tells the page it is looking at a draft.
 *
 * Null still means "nothing to say": no file here, and no other stage's file
 * complete enough to borrow the product settings from.
 */
export function readSettings(stage: string): EnvironmentSettings | null {
  const config = readConfig(stage);
  const seedStage = config ? null : pickSeedStage(stage);
  const source = config ?? (seedStage ? readConfig(seedStage) : null);
  if (!source) return null;

  const draft = config === null;
  const ownership = draft
    ? { tables: true, media: true, auth: true }
    : ownershipOf(config);

  return {
    stage,
    configPath: configFile(stage),
    hasConfig: !draft,
    seededFrom: draft ? seedStage : null,
    account: source.account ?? null,
    region: source.region ?? null,
    ownership,
    // A draft is a *new environment*: it creates the tables, the media and the
    // pool, so it needs a secret for the provider its pool is built with. An
    // imported pool already has its provider attached and a deploy never reads
    // the secret.
    needsGoogleSecret: draft ? true : ownership.auth,
    googleClientSecretName: googleClientSecretName(stage),
    googleClientSecretSet: false,
    auth: {
      googleClientId: source.auth?.googleClientId ?? "",
      callbackUrls: source.auth?.callbackUrls ?? [],
      logoutUrls: source.auth?.logoutUrls ?? [],
    },
    mail: {
      fromAddress: source.mail?.fromAddress ?? EMPTY.fromAddress,
      appBaseUrl: source.mail?.appBaseUrl ?? EMPTY.appBaseUrl,
      marketplaceBaseUrl: source.mail?.marketplaceBaseUrl ?? EMPTY.marketplaceBaseUrl,
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
  account?: string | null,
): Promise<GoogleOAuthValues> {
  const config = readConfig(stage);
  const outputs = await stageOutputs(stage, ctx).catch(() => null);

  // Two shapes of the same thing, normalised to the full hostname: the stack
  // output already includes `.amazoncognito.com` because CDK returns the
  // distribution's domain, while a config file names only the pool's *prefix*.
  // Appending unconditionally is how this becomes
  // `…amazoncognito.com.amazoncognito.com`, which Google accepts as a valid
  // origin and then never matches.
  //
  // `account` is the fallback for a stage with no config file yet: a new
  // environment has no pool to read a domain off, and the domain it *will* have
  // is derived from the account the deploy is about to use — which is the one
  // thing the console has to be told while the file is still a draft.
  const host = outputs?.cognitoDomain
    ? outputs.cognitoDomain
    : config?.existing?.userPoolDomain
      ? `${config.existing.userPoolDomain}.auth.${config.region}.amazoncognito.com`
      : (config?.account ?? account)
        ? `play-${stage}-${config?.account ?? account}.auth.${config?.region ?? ctx.region}.amazoncognito.com`
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
 * Three destinations, deliberately kept apart:
 *
 * - the **configuration** goes into the committed config file. When there is no
 *   file yet, this creates one — a *new environment*, `ownership` all `true` and
 *   no `existing` block — which is what makes this form the way an environment
 *   is created rather than something to fill in afterwards;
 * - the **secret** goes to Secrets Manager, write-only in both directions;
 * - the **signing key**, which is the one thing nobody can type, is created if
 *   it is missing and left alone if it is there.
 *
 * Nothing else in an existing file is touched — it is read, two blocks are
 * replaced, and it is written back — so a field this view does not know about
 * survives a save.
 */
export async function saveSettings(
  stage: string,
  input: EnvironmentSettingsInput,
  ctx: { profile?: string; region?: string } = {},
): Promise<{ settings: EnvironmentSettings; write: SettingsWriteView }> {
  const before = readConfig(stage);
  const seedStage = before ? null : pickSeedStage(stage);
  const seed = seedStage ? readConfig(seedStage) : null;

  if (!before && !seed) {
    throw new Error(
      `There is no infra/config/play-${stage}.json yet, and no other environment's config to ` +
        "take the product settings from. Write one by hand — it is the file that says what this " +
        "environment creates or imports.",
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

  const created = before === null;
  let file: string;
  if (before) {
    file = writeConfig({ ...before, auth, mail });
  } else {
    // The account the console is acting as, not the seed's: the file has to name
    // the account the deploy will actually use, and the two are compared in the
    // plan's second step.
    const identity = await getIdentity({ profile: ctx.profile, region: ctx.region }).catch(
      () => null,
    );
    file = writeConfig(
      newStageConfig(stage, seed, {
        account: identity?.account ?? seed?.account ?? null,
        region: ctx.region ?? seed?.region ?? null,
        auth,
        mail,
      }),
    );
  }

  if (input.googleClientSecret) {
    await writeGoogleSecret(stage, input.googleClientSecret, ctx);
  }

  const settings = readSettings(stage);
  if (!settings) throw new Error(`Wrote ${file}, but it could not be read back.`);
  settings.googleClientSecretSet = await googleSecretStatus(stage, ctx);
  settings.oauth = await googleOAuthValues(stage, ctx, settings.account);

  return {
    settings,
    write: {
      configPath: file,
      created,
      secretWritten: Boolean(input.googleClientSecret),
      ...(await keyNote(stage, settings, ctx)),
    },
  };
}

/**
 * The signing key, as part of a save.
 *
 * Only for an environment that creates its own media — one that imports a
 * distribution has a key pair already, and the pair it signs with is the one
 * that distribution was created against. A failure here does **not** fail the
 * save: the settings are the thing this request asked for, and they are on disk.
 * What happened to the key is reported either way, because "saved" without it
 * would be a summary that hides the half of it that matters.
 */
async function keyNote(
  stage: string,
  settings: EnvironmentSettings,
  ctx: { profile?: string; region?: string },
): Promise<{ signingKeyNote: string | null; signingKeyReady: boolean }> {
  if (!settings.ownership.media) return { signingKeyNote: null, signingKeyReady: true };

  try {
    const ensured = await ensureSigningKey(stage, ctx);
    return { signingKeyNote: ensured.note, signingKeyReady: ensured.key.ready };
  } catch (error) {
    return {
      signingKeyNote: `the signing key was not created — ${
        error instanceof Error ? error.message : String(error)
      }`,
      signingKeyReady: false,
    };
  }
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
