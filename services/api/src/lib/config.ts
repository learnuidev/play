function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  tableName: required('VIDEOS_TABLE', process.env.VIDEOS_TABLE),
  organizationsTableName: required('ORGANIZATIONS_TABLE', process.env.ORGANIZATIONS_TABLE),
  orgMembersTableName: required('ORG_MEMBERS_TABLE', process.env.ORG_MEMBERS_TABLE),
  spacesTableName: required('SPACES_TABLE', process.env.SPACES_TABLE),
  sectionsTableName: required('SECTIONS_TABLE', process.env.SECTIONS_TABLE),
  contentsTableName: required('CONTENTS_TABLE', process.env.CONTENTS_TABLE),
  questionsTableName: required('QUESTIONS_TABLE', process.env.QUESTIONS_TABLE),
  questionBanksTableName: required('QUESTION_BANKS_TABLE', process.env.QUESTION_BANKS_TABLE),
  quizQuestionsTableName: required('QUIZ_QUESTIONS_TABLE', process.env.QUIZ_QUESTIONS_TABLE),
  quizAttemptsTableName: required('QUIZ_ATTEMPTS_TABLE', process.env.QUIZ_ATTEMPTS_TABLE),
  contentFilesTableName: required('CONTENT_FILES_TABLE', process.env.CONTENT_FILES_TABLE),
  favouritesTableName: required('FAVOURITES_TABLE', process.env.FAVOURITES_TABLE),
  playlistTableName: required('PLAYLIST_TABLE', process.env.PLAYLIST_TABLE),
  commentsTableName: required('COMMENTS_TABLE', process.env.COMMENTS_TABLE),
  contentLoopsTableName: required('CONTENT_LOOPS_TABLE', process.env.CONTENT_LOOPS_TABLE),
  completionsTableName: required('COMPLETIONS_TABLE', process.env.COMPLETIONS_TABLE),
  spaceMembersTableName: required('SPACE_MEMBERS_TABLE', process.env.SPACE_MEMBERS_TABLE),
  cohortsTableName: required('COHORTS_TABLE', process.env.COHORTS_TABLE),
  cohortMembersTableName: required('COHORT_MEMBERS_TABLE', process.env.COHORT_MEMBERS_TABLE),
  spaceRewardsTableName: required('SPACE_REWARDS_TABLE', process.env.SPACE_REWARDS_TABLE),
  rewardGrantsTableName: required('REWARD_GRANTS_TABLE', process.env.REWARD_GRANTS_TABLE),
  apiKeysTableName: required('API_KEYS_TABLE', process.env.API_KEYS_TABLE),
  profilesTableName: required('PROFILES_TABLE', process.env.PROFILES_TABLE),
  /**
   * OAuth: the apps people register, the authorizations those apps are given,
   * and the two kinds of credential a grant produces — authorization codes on
   * their way through a browser, and the access and refresh tokens they become.
   *
   * Four tables rather than one because they are four different lifetimes: an app
   * is a setting somebody maintains, a grant is a permission a person can read
   * and take back, a code lives for a minute and a token for an hour or a month.
   * What they have in common is that none of the three credential tables ever
   * holds a secret — the plaintext exists once, in the response that created it,
   * and what is stored is a SHA-256 of it.
   */
  oauthAppsTableName: required('OAUTH_APPS_TABLE', process.env.OAUTH_APPS_TABLE),
  oauthGrantsTableName: required('OAUTH_GRANTS_TABLE', process.env.OAUTH_GRANTS_TABLE),
  oauthTokensTableName: required('OAUTH_TOKENS_TABLE', process.env.OAUTH_TOKENS_TABLE),
  oauthCodesTableName: required('OAUTH_CODES_TABLE', process.env.OAUTH_CODES_TABLE),
  /**
   * What was paid for a course, keyed by the Stripe payment the purchase was
   * made with — the intent for one made in the marketplace, the session for the
   * older hosted-page purchases. Written by the webhook and by the checkout
   * route that opens the payment — see
   * `functions/payments/stripe-webhook.ts` — and read by the marketplace's own
   * screens.
   */
  paymentsTableName: required('PAYMENTS_TABLE', process.env.PAYMENTS_TABLE),
  /**
   * The cards people have saved, keyed by their own `sub` and Stripe's `pm_…`
   * id. **Tokens, not cards**: what is written here is what Stripe handed back
   * after somebody entered a card on Stripe's own page — the brand, the last four
   * digits and the expiry — and nothing that could be used to charge anybody on
   * its own. See `lib/payment-methods.ts`.
   */
  paymentMethodsTableName: required('PAYMENT_METHODS_TABLE', process.env.PAYMENT_METHODS_TABLE),
  /**
   * Where this deployment's Stripe credentials live. **Names, not values**: the
   * API key and the webhook signing secret are read from Secrets Manager at the
   * moment they are needed, and the publishable key — which is not a secret, and
   * is served to browsers — from Parameter Store.
   *
   * Two secrets rather than one, because they are rotated for different reasons:
   * the API key on somebody's schedule, the endpoint's signing secret when the
   * endpoint is recreated. One document holding both would make each rotation a
   * write of the other value as well.
   */
  stripeSecretName: required('STRIPE_SECRET_NAME', process.env.STRIPE_SECRET_NAME),
  stripeWebhookSecretName: required(
    'STRIPE_WEBHOOK_SECRET_NAME',
    process.env.STRIPE_WEBHOOK_SECRET_NAME,
  ),
  stripePublishableKeyParam: required(
    'STRIPE_PUBLISHABLE_KEY_PARAM',
    process.env.STRIPE_PUBLISHABLE_KEY_PARAM,
  ),
  /**
   * The Stripe **product tax code** every course is sold under.
   *
   * Not optional and not cosmetic. Stripe's *Managed Payments* is enabled by default
   * on a new account, and it refuses to open a checkout session for a product with
   * no tax code:
   *
   *   Invalid line_items[0]: the product tax code is missing. Set the product's
   *   tax_code field to an eligible product tax code.
   *
   * Which code is a **tax classification**, not a technical choice, and it is the
   * one thing here this repository cannot decide for the product. The default is the
   * closest match to what a Play course is — video lessons streamed over the web,
   * bought once, watched but not owned:
   *
   *   txcd_10402000  Digital Audio Visual Works - streamed - non subscription -
   *                  with limited rights
   *
   * Stripe's own list is the authority, and the candidates a course might reasonably
   * be instead are worth knowing by name, because their descriptions are what
   * decides it:
   *
   *   txcd_10000000  General - Electronically Supplied Services — the catch-all for
   *                  a digital service; Stripe asks you to prefer something more
   *                  specific "especially if you sell in the US".
   *   txcd_20060058  Training Services - Self-study Web-based — for a course taught
   *                  rather than watched, and it explicitly *excludes* "downloads or
   *                  streaming of video replays", which is why it is not the default.
   *   txcd_20060052  Educational Services — academic classes from a school.
   *
   * Read the whole list for the account this is deploying to with:
   *
   *   curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
   *     "https://api.stripe.com/v1/tax_codes?limit=100" | jq '.data[] | "\(.id)  \(.name)"'
   *
   * Changing it is a value, not a code change: the function's own `environment` in
   * `infra/src/generated/service.ts`, beside `BEDROCK_MODEL_ID`. Prices already made
   * carry the old code, and the next checkout replaces them — see `productTaxCode`
   * in `lib/stripe`.
   */
  stripeProductTaxCode: process.env.STRIPE_PRODUCT_TAX_CODE ?? 'txcd_10402000',
  bucket: required('VIDEOS_BUCKET', process.env.VIDEOS_BUCKET),
  cloudfrontDomain: required('CLOUDFRONT_DOMAIN', process.env.CLOUDFRONT_DOMAIN),
  /**
   * Where the signing key's **CloudFront id** lives, rather than the id itself.
   *
   * The same move as the private key below, and for a second reason of its own: a
   * CloudFront public key is immutable, so rotating one is a deploy that creates a
   * new key with a new id. Were the id in this environment as a cross-stack
   * value, that deploy would have to rename a CloudFormation export this stack
   * still imports — which CloudFormation refuses to do. Read from Parameter
   * Store, `lib/cloudfront-key` picks up a rotation without this service being
   * deployed at all.
   */
  cloudfrontKeyPairIdParam: required(
    'CLOUDFRONT_KEY_PAIR_ID_PARAM',
    process.env.CLOUDFRONT_KEY_PAIR_ID_PARAM,
  ),
  /**
   * Where the signing key lives, rather than the key itself.
   *
   * The key is a 2.3 KB SecretString, and every function in this service was
   * being handed a copy of it through the environment — which is both most of
   * the 4 KB environment limit and a private key readable in the console from a
   * hundred functions that never sign anything. `lib/cloudfront-key` fetches it
   * from here on first use and holds it for the container's life.
   */
  cloudfrontPrivateKeyParam:
    process.env.CLOUDFRONT_PRIVATE_KEY_PARAM ?? '/play/cloudfront/private-key',
  mediaconvertRoleArn: required('MEDIACONVERT_ROLE_ARN', process.env.MEDIACONVERT_ROLE_ARN),
  transcribeRoleArn: required('TRANSCRIBE_ROLE_ARN', process.env.TRANSCRIBE_ROLE_ARN),

  /**
   * Which Bedrock model writes a quiz's questions, and where.
   *
   * A model id rather than an endpoint, because Bedrock is one API with many
   * models behind it: `us.amazon.nova-lite-v1:0` is the default — an Amazon
   * model, which needs no access request in the console, and a cross-region
   * inference profile, which is what an `us.` prefix is — and swapping in a
   * Claude or Llama model is this string and nothing else.
   *
   * It is read here with a default rather than required, so a deployment that
   * never generates anything does not fail to start over it. Only the
   * generation function is given it; see `infra/src/generated/service.ts`.
   */
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-lite-v1:0',
  subtitleLanguage: process.env.SUBTITLE_LANGUAGE ?? 'en-US',
  streamTtlSeconds: Number(process.env.STREAM_URL_TTL_SECONDS ?? 900),

  /**
   * Address invitation emails are sent from. Must be an identity SES has
   * verified in this region — see scripts/set-mail-sender.sh. Empty means this
   * deployment does not send mail at all, which is a supported state: the
   * invitation is still written, and the admin is handed the link to pass on.
   */
  mailFromAddress: process.env.MAIL_FROM_ADDRESS ?? '',

  /**
   * Where an invitation email points. The page it lands on is where the offer
   * is listed and claimed, so the email carries a link to the app rather than a
   * link with a token in it — there is no token, and being signed in as the
   * invited address is what accepting means.
   */
  appBaseUrl: (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),

  /**
   * Where the marketplace is served.
   *
   * A learner's emails point here rather than at the studio: a reward is
   * something they were given in a course they are taking, and the studio is
   * where courses are *written*. The page that lists what they earned belongs to
   * the app they take courses in.
   */
  marketplaceBaseUrl: (process.env.MARKETPLACE_BASE_URL ?? 'http://localhost:3001').replace(
    /\/+$/,
    '',
  ),
};
