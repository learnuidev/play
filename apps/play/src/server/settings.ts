import type {
  AuthUrlsWriteView,
  EnvironmentSettings,
  EnvironmentSettingsInput,
  GoogleOAuthValues,
  SettingsWriteView,
  StripeSettingsView,
  StripeWriteView,
} from "@/lib/types";
import { applyAuthUrls } from "./auth-urls";
import { awsJson, describeStack, getIdentity } from "./aws";
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
 * - the address invitations come from and the two app base URLs;
 * - the Stripe credentials a course is sold with — the API key, the endpoint's
 *   signing secret, and the publishable key a browser loads Stripe.js with.
 *
 * They are the values a new environment needs before it can deploy, because its
 * user pool is created from them. On `dev` they describe a pool that already
 * exists — nothing here redeploys it, so saving **applies** the URLs to that
 * pool instead of waiting for a deploy that will never come: this module runs
 * `set-auth-urls.mjs`, and `auth-urls.ts` is where that is explained.
 *
 * ## The secrets never touch the config file
 *
 * The config file is committed. The Google client secret and the two Stripe
 * credentials are write-only: sent to Secrets Manager and never read back, never
 * echoed, and never written to disk in the repository. `readSettings` reports
 * only whether each one is stored.
 *
 * Secrets Manager rather than SSM because CloudFormation refuses an SSM Secure
 * reference in `AWS::Cognito::UserPoolIdentityProvider` — see
 * `infra/src/stacks/auth-stack.ts`. The one Stripe value that is not there is the
 * publishable key, which is not a secret at all: it goes to Parameter Store, and
 * the form shows it, because hiding the value a browser is going to receive would
 * be hiding nothing.
 */

/** The secret name for a stage. Mirrors `googleClientSecretName` in `infra/src/config.ts`. */
export function googleClientSecretName(stage: string): string {
  return `play/${stage}/google-client-secret`;
}

/**
 * Where a stage's Stripe credentials live. Mirrors `infra/src/config.ts`.
 *
 * **Per stage**, like the Google client secret: these are the keys a deployment
 * charges with, and two environments holding the same one are two environments
 * spending one account's money.
 *
 * Two secrets rather than one, because the two values are rotated for different
 * reasons — the API key on somebody's schedule, the endpoint's signing secret
 * when the endpoint is recreated — and the console never reads a credential back,
 * so one document for both would make every rotation a write of the value
 * nobody asked to change.
 */
export function stripeSecretName(stage: string): string {
  return `play/${stage}/stripe-secret-key`;
}

export function stripeWebhookSecretName(stage: string): string {
  return `play/${stage}/stripe-webhook-secret`;
}

/** The publishable key — not a secret, so it lives in SSM with the other settings. */
export function stripePublishableKeyParam(stage: string): string {
  return `/play/${stage}/stripe/publishable-key`;
}

/**
 * The Stripe events the deployed webhook does something about.
 *
 * Shown so nobody has to read the handler to know what to subscribe an endpoint
 * to — and it is a *copy* of that handler's `switch`, which is the authority:
 * `services/api/src/functions/payments/stripe-webhook.ts`. The drift is harmless
 * in one direction only, and this is it: subscribing to an event the handler does
 * not know is answered with a 200 saying so, while subscribing to none of these
 * is a payment that never becomes an enrolment.
 *
 * `payment_intent.succeeded` is the one that matters most: it is what a course
 * being **bought** on the marketplace's own checkout arrives as, and a deployment
 * that does not subscribe to it takes money and enrols nobody.
 *
 * `checkout.session.completed` is the hosted page this deployment used to send
 * buyers to, kept for the stragglers — a page somebody still has open — and it is
 * two features in one event: a course being bought, and a card being **saved**,
 * because saving one was the same page in `mode=setup`. The handler branches on
 * the session's mode. There is nothing extra to subscribe to for saved cards.
 */
export const STRIPE_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
  "charge.refunded",
];

/**
 * The Stripe half of an environment's settings: what is stored, and where Stripe
 * has to be pointed.
 *
 * Four reads rather than one, and they are the four different things a person
 * needs before a course can be sold: two secrets that must exist, a publishable
 * key that must be readable, and a webhook URL that only exists once the payment
 * stack has been deployed. None of them is cached — the checklist is drawn on
 * every page load and a stale "not set" is exactly the state this page exists to
 * end.
 */
export async function stripeState(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<StripeSettingsView> {
  const secretName = stripeSecretName(stage);
  const webhookSecretName = stripeWebhookSecretName(stage);
  const publishableKeyParam = stripePublishableKeyParam(stage);

  const [secretKeySet, webhookSigningSecretSet, publishableKey, webhookUrl] = await Promise.all([
    secretStored(secretName, ctx),
    secretStored(webhookSecretName, ctx),
    publishableKeyValue(publishableKeyParam, ctx),
    stripeWebhookUrl(stage, ctx),
  ]);

  return {
    secretName,
    secretKeySet,
    webhookSecretName,
    webhookSigningSecretSet,
    publishableKeyParam,
    publishableKey,
    webhookUrl,
    events: STRIPE_EVENTS,
  };
}

/**
 * The endpoint Stripe is pointed at, which the payment stack publishes.
 *
 * Read from the stack rather than derived from anything: a Lambda function URL
 * carries a random subdomain that no rule here could reconstruct, and it is
 * assigned when the function is created — so the only place the URL is
 * authoritative is the stack that made it.
 */
async function stripeWebhookUrl(
  stage: string,
  ctx: { profile?: string; region?: string },
): Promise<string | null> {
  const stack = await describeStack(`PlayPaymentStack-${stage}`, ctx).catch(() => null);
  return stack?.outputs.StripeWebhookUrl ?? null;
}

/** The publishable key's value, or null when the parameter is not there yet. */
async function publishableKeyValue(
  name: string,
  ctx: { profile?: string; region?: string },
): Promise<string | null> {
  const found = await awsJson<{ Parameter?: { Value?: string } }>(
    ["ssm", "get-parameter", "--name", name],
    { ...ctx, optional: true },
  ).catch(() => null);
  return found?.Parameter?.Value ?? null;
}

/**
 * `pk_`, `sk_` and `whsec_`: the prefixes Stripe gives its three kinds of value.
 *
 * Checked because all three look alike in a dashboard — three long strings with
 * underscores — and pasting the secret key into the publishable field is a
 * mistake that would reach a browser, while pasting the publishable key into the
 * webhook field is a webhook that verifies nothing. Each sentence says which
 * value belongs there rather than naming a format.
 */
function stripeProblems(input: NonNullable<EnvironmentSettingsInput["stripe"]>): string[] {
  const problems: string[] = [];

  if (input.secretKey && !input.secretKey.startsWith("sk_")) {
    problems.push(
      'The Stripe secret key starts with "sk_" — it is the API key ("Secret key") in the Stripe dashboard, not the publishable one.',
    );
  }
  if (input.webhookSigningSecret && !input.webhookSigningSecret.startsWith("whsec_")) {
    problems.push(
      'The webhook signing secret starts with "whsec_" — it is shown by the endpoint you create in Stripe, under "Signing secret".',
    );
  }
  if (input.publishableKey && !input.publishableKey.startsWith("pk_")) {
    problems.push(
      'The publishable key starts with "pk_" — it is the "Publishable key" in the Stripe dashboard, and it is the one safe to hand to a browser.',
    );
  }

  return problems;
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
    // Also filled in by the route: three of these four are AWS reads, and the
    // form is drawn whether or not they answer.
    stripe: {
      secretName: stripeSecretName(stage),
      secretKeySet: false,
      webhookSecretName: stripeWebhookSecretName(stage),
      webhookSigningSecretSet: false,
      publishableKeyParam: stripePublishableKeyParam(stage),
      publishableKey: null,
      webhookUrl: null,
      events: STRIPE_EVENTS,
    },
  };
}

/** Whether a Secrets Manager secret with this name exists and has a value. */
export async function googleSecretStatus(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<boolean> {
  return secretStored(googleClientSecretName(stage), ctx);
}

/**
 * Whether a secret exists and was given a value.
 *
 * `describe-secret` answers with the ARN but not the value, which is exactly what
 * is wanted: this is about whether a credential is *there*, and the console has
 * no reason to read one.
 */
async function secretStored(
  name: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<boolean> {
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
 * Four destinations, deliberately kept apart:
 *
 * - the **configuration** goes into the committed config file. When there is no
 *   file yet, this creates one — a *new environment*, `ownership` all `true` and
 *   no `existing` block — which is what makes this form the way an environment
 *   is created rather than something to fill in afterwards;
 * - the **URLs Cognito will accept** go onto the pool that is running now, by
 *   running `set-auth-urls.mjs` — see `auth-urls.ts` for why a file write is not
 *   enough on a stage that imports its pool;
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
  const stripe = input.stripe ?? null;
  if (stripe) problems.push(...stripeProblems(stripe));
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

  const stripeWrite = stripe ? await writeStripe(stage, stripe, ctx) : null;

  const settings = readSettings(stage);
  if (!settings) throw new Error(`Wrote ${file}, but it could not be read back.`);
  settings.googleClientSecretSet = await googleSecretStatus(stage, ctx);
  settings.oauth = await googleOAuthValues(stage, ctx, settings.account);
  settings.stripe = await stripeState(stage, ctx);

  return {
    settings,
    write: {
      configPath: file,
      created,
      secretWritten: Boolean(input.googleClientSecret),
      authUrls: await authUrlsNote(stage, auth, ctx),
      stripe: stripeWrite,
      ...(await keyNote(stage, settings, ctx)),
    },
  };
}

/**
 * The Stripe credentials, as part of a save.
 *
 * Each of the three is written on its own terms, and they are not the same terms:
 *
 * - the **API key** and the **signing secret** are secrets, so an empty field
 *   means "leave it alone" — the console has no way to show the stored value for
 *   somebody to keep, which is the whole point of never reading one back;
 * - the **publishable key** is not a secret and is shown in the form, so an empty
 *   field means what it looks like: the parameter is removed, and a deployment
 *   with no publishable key cannot take a payment.
 *
 * A failure here fails the save, unlike the signing key and the app client beside
 * it. The difference is what the write *is*: those two are side effects of saving
 * settings that are already on disk, while a credential is the thing that was
 * asked for — a save that reported success over a Secrets Manager refusal would
 * be a deployment that looks ready to charge and is not.
 */
async function writeStripe(
  stage: string,
  input: NonNullable<EnvironmentSettingsInput["stripe"]>,
  ctx: { profile?: string; region?: string },
): Promise<StripeWriteView> {
  const write: StripeWriteView = {
    secretKeyWritten: false,
    webhookSigningSecretWritten: false,
    publishableKeyWritten: false,
  };

  if (input.secretKey) {
    await writeSecret(
      stripeSecretName(stage),
      input.secretKey,
      `Stripe API key for the ${stage} environment`,
      ctx,
    );
    write.secretKeyWritten = true;
  }

  if (input.webhookSigningSecret) {
    await writeSecret(
      stripeWebhookSecretName(stage),
      input.webhookSigningSecret,
      `Stripe webhook signing secret for the ${stage} environment`,
      ctx,
    );
    write.webhookSigningSecretWritten = true;
  }

  if (input.publishableKey !== undefined) {
    const name = stripePublishableKeyParam(stage);
    const value = input.publishableKey.trim();
    if (value) {
      await awsJson(
        [
          "ssm",
          "put-parameter",
          "--name",
          name,
          "--value",
          value,
          // A plain String: this value is served to browsers, and a SecureString
          // here would make every frontend read a decryption to show a page.
          "--type",
          "String",
          "--overwrite",
        ],
        ctx,
      );
      write.publishableKeyWritten = true;
    } else {
      // SSM refuses an empty value, so "cleared" is the parameter not being
      // there — which is also the state a deployment that has never been
      // configured is in, and the one the checklist reports as missing.
      await awsJson(["ssm", "delete-parameter", "--name", name], { ...ctx, optional: true });
    }
  }

  return write;
}

/**
 * The live app client, as part of a save.
 *
 * The stage's own URLs rather than the script's defaults, which are the product's
 * deployed origins — see `auth-urls.ts`. A failure does **not** fail the save for
 * the same reason the signing key's does not: the file is written and is the
 * thing that was asked for, and a stage with no pool yet is not an error. What
 * happened is reported either way, because "saved" without it would be a summary
 * that hides the half of it that decides whether a sign-in works.
 */
async function authUrlsNote(
  stage: string,
  auth: { callbackUrls: string[]; logoutUrls: string[] },
  ctx: { profile?: string; region?: string },
): Promise<AuthUrlsWriteView> {
  try {
    return await applyAuthUrls(stage, auth, ctx);
  } catch (error) {
    return {
      applied: false,
      note: error instanceof Error ? error.message : String(error),
    };
  }
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
 * The Google client secret, written on the same terms as the Stripe ones.
 *
 * The user pool's identity provider is built from it at deploy, so it has to be
 * in Secrets Manager before the pool that reads it exists — which is why this is
 * named rather than being one more call in `saveSettings`.
 */
async function writeGoogleSecret(
  stage: string,
  value: string,
  ctx: { profile?: string; region?: string },
): Promise<void> {
  await writeSecret(
    googleClientSecretName(stage),
    value,
    `Google OAuth client secret for the ${stage} environment`,
    ctx,
  );
}

/**
 * Create a secret, or replace its value.
 *
 * `create-secret` and `put-secret-value` rather than `put-secret-value` alone,
 * because the first save for an environment has nothing to put to. Not
 * `update-secret`, which is for metadata and would leave a fresh secret with no
 * value at all — and a secret with no value is one CloudFormation resolves to an
 * empty string, which the provider then rejects at the first sign-in rather than
 * at the deploy.
 *
 * One function for all three credentials here — the Google client secret and the
 * two Stripe ones — because the operation is the same and the differences between
 * them are in the *names* and their descriptions, which the callers supply.
 */
async function writeSecret(
  name: string,
  value: string,
  description: string,
  ctx: { profile?: string; region?: string },
): Promise<void> {
  const exists = await secretStored(name, ctx);

  const argv = exists
    ? ["secretsmanager", "put-secret-value", "--secret-id", name, "--secret-string", value]
    : [
        "secretsmanager",
        "create-secret",
        "--name",
        name,
        "--description",
        description,
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
