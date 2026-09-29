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
  bucket: required('VIDEOS_BUCKET', process.env.VIDEOS_BUCKET),
  cloudfrontDomain: required('CLOUDFRONT_DOMAIN', process.env.CLOUDFRONT_DOMAIN),
  cloudfrontKeyPairId: required('CLOUDFRONT_KEY_PAIR_ID', process.env.CLOUDFRONT_KEY_PAIR_ID),
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
