#!/usr/bin/env bash
#
# Stores the Google OAuth client credentials used for "Sign in with Google" in
# AWS SSM Parameter Store:
#
#   /play/auth/google-client-id   (String)        Google OAuth client id
#   /play/auth/google-client-secret (SecureString) Google OAuth client secret
#   /play/auth/callback-urls      (String)        comma-separated callback URLs
#   /play/auth/logout-urls        (String)        comma-separated logout URLs
#
# The credentials live in SSM because they are a secret and because that is where
# the deployment record keeps them — `infra/scripts/import-state.mjs` reads the
# client id back into `infra/config/play-<stage>.json`, which is what a *new*
# user pool would be built from.
#
# ## What changed when the backend moved to CDK
#
# Nothing about this pool is deployed any more: `PlayAuthStack` **imports** it,
# and an imported resource is unmanaged, so there is no deploy that applies these
# values. The identity provider is therefore created here, through the Cognito
# API, and the app client's provider list is updated by `set-auth-urls.mjs`
# (which reads the client before writing it, because `UpdateUserPoolClient` sends
# every attribute it is not given back to its default).
#
# The Hosted UI domain and the pool itself are part of the same import, so an
# account that has never had Google configured needs those created by hand as
# well — see docs/migration.md.
#
# Prerequisites — in the Google Cloud Console (APIs & Services > Credentials):
#
#   1. Create an OAuth client ID of type "Web application".
#   2. Authorized JavaScript origins: https://<cognito-domain>
#   3. Authorized redirect URIs:       https://<cognito-domain>/oauth2/idpresponse
#
#   This script prints both values (the Cognito domain) after it runs.
#
# Usage:
#   ./scripts/set-google-oauth.sh --client-id=<id> [options]
#
# Options:
#   --client-id=<id>        Google OAuth client id      (prompted if omitted)
#   --client-secret=<secret> Google OAuth client secret  (prompted if omitted)
#   --callback-urls=<urls>  comma-separated              (default: both apps on localhost)
#   --logout-urls=<urls>    comma-separated              (default: both apps on localhost)
#   --stage=<name>          Backend stage                (default: dev)
#   --profile=<name>        AWS profile                  (default: scripts/api-config.env)
#   --region=<name>         AWS region                   (default: us-east-1)
#   --delete                Remove the parameters (disables Google sign-in)
#   --help                  Show this help
set -euo pipefail

# The AWS profile is not written down here: `scripts/api-config.env` is the one
# place that names it, and an AWS_PROFILE in the environment wins over that file.
# shellcheck source=../../../scripts/api-config.env
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/scripts/api-config.env"
PROFILE="${AWS_PROFILE:-$API_AWS_PROFILE}"
REGION="us-east-1"
STAGE="dev"
CLIENT_ID=""
CLIENT_SECRET=""
CALLBACK_URLS="http://localhost:3000/auth/callback,http://localhost:3000,http://localhost:3001/auth/callback,http://localhost:3001"
LOGOUT_URLS="http://localhost:3000,http://localhost:3001"
DELETE=false

usage() {
  # The header comment as written, minus the shebang and the `# ` that marks it:
  # every leading comment line, stopping at the first line of code. Reading it by
  # line number (as this used to) breaks the moment the comment changes length.
  awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --client-id=*) CLIENT_ID="${1#*=}" ;;
    --client-secret=*) CLIENT_SECRET="${1#*=}" ;;
    --callback-urls=*) CALLBACK_URLS="${1#*=}" ;;
    --logout-urls=*) LOGOUT_URLS="${1#*=}" ;;
    --stage=*) STAGE="${1#*=}" ;;
    --profile=*) PROFILE="${1#*=}" ;;
    --region=*) REGION="${1#*=}" ;;
    --delete) DELETE=true ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
  shift
done

if [[ "$DELETE" == true ]]; then
  for name in google-client-id google-client-secret callback-urls logout-urls; do
    aws ssm delete-parameter \
      --name "/play/auth/$name" \
      --profile "$PROFILE" \
      --region "$REGION" >/dev/null 2>&1 || true
    echo "Deleted /play/auth/$name (if it existed)"
  done
  POOL_ID="$(aws_ cloudformation describe-stacks --stack-name "PlayAuthStack-$STAGE" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" \
    --output text 2>/dev/null || true)"

  if [[ -n "$POOL_ID" && "$POOL_ID" != "None" ]]; then
    echo
    echo "Deleting the Google identity provider from $POOL_ID..."
    aws_ cognito-idp delete-identity-provider \
      --user-pool-id "$POOL_ID" --provider-name Google >/dev/null 2>&1 \
      && echo "  deleted" || echo "  (not present, or could not be deleted)"
  fi

  cat <<EOF

Then stop the app client offering it:

  node services/api/scripts/set-auth-urls.mjs --no-google --stage=$STAGE

An existing Hosted UI domain is left in place: nothing depends on it once Google
is off, and removing it would change the URL both apps' sign-out returns to.
EOF
  exit 0
fi

if [[ -z "$CLIENT_ID" ]]; then
  read -r -p "Google OAuth client id: " CLIENT_ID
fi
if [[ -z "$CLIENT_SECRET" ]]; then
  read -r -s -p "Google OAuth client secret: " CLIENT_SECRET
  echo
fi

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "Both a client id and a client secret are required." >&2
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity \
  --query Account --output text \
  --profile "$PROFILE" --region "$REGION")"

echo
echo "Writing SSM parameters (profile: $PROFILE, region: $REGION)..."
aws ssm put-parameter --name /play/auth/google-client-id --type String \
  --value "$CLIENT_ID" --overwrite --profile "$PROFILE" --region "$REGION" >/dev/null
aws ssm put-parameter --name /play/auth/google-client-secret --type SecureString \
  --value "$CLIENT_SECRET" --overwrite --profile "$PROFILE" --region "$REGION" >/dev/null
aws ssm put-parameter --name /play/auth/callback-urls --type String \
  --value "$CALLBACK_URLS" --overwrite --profile "$PROFILE" --region "$REGION" >/dev/null
aws ssm put-parameter --name /play/auth/logout-urls --type String \
  --value "$LOGOUT_URLS" --overwrite --profile "$PROFILE" --region "$REGION" >/dev/null

DOMAIN="play-${STAGE}-${ACCOUNT_ID}.auth.${REGION}.amazoncognito.com"

POOL_ID="$(aws_ cloudformation describe-stacks --stack-name "PlayAuthStack-$STAGE" \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" \
  --output text 2>/dev/null || true)"

if [[ -z "$POOL_ID" || "$POOL_ID" == "None" ]]; then
  cat <<EOF

SSM parameters written, but the user pool id could not be read from
PlayAuthStack-$STAGE — deploy the backend and run this again, or pass the pool
id by hand:

  aws cognito-idp create-identity-provider --user-pool-id <pool id> \
    --provider-name Google --provider-type Google \
    --provider-details 'client_id=$CLIENT_ID,client_secret=$CLIENT_SECRET,authorize_scopes=email profile openid' \
    --attribute-mapping '{"email":"email","email_verified":"email_verified","given_name":"given_name","family_name":"family_name","name":"name","picture":"picture"}' \
    --profile $PROFILE --region $REGION
EOF
  exit 1
fi

echo
echo "Configuring the Google identity provider on $POOL_ID (profile: $PROFILE)..."

# Create, then update if it is already there: this script is re-run whenever the
# Google client is rotated, and `create` fails on the second run.
PROVIDER_DETAILS="client_id=$CLIENT_ID,client_secret=$CLIENT_SECRET,authorize_scopes=email profile openid"
ATTRIBUTE_MAPPING='{"email":"email","email_verified":"email_verified","given_name":"given_name","family_name":"family_name","name":"name","picture":"picture"}'

aws_ cognito-idp describe-identity-provider \
  --user-pool-id "$POOL_ID" --provider-name Google >/dev/null 2>&1 && PROVIDER_EXISTS=true || PROVIDER_EXISTS=false

if [[ "$PROVIDER_EXISTS" == true ]]; then
  aws_ cognito-idp update-identity-provider \
    --user-pool-id "$POOL_ID" --provider-name Google \
    --provider-details "$PROVIDER_DETAILS" \
    --attribute-mapping "$ATTRIBUTE_MAPPING" >/dev/null
  echo "  updated"
else
  aws_ cognito-idp create-identity-provider \
    --user-pool-id "$POOL_ID" --provider-name Google --provider-type Google \
    --provider-details "$PROVIDER_DETAILS" \
    --attribute-mapping "$ATTRIBUTE_MAPPING" >/dev/null
  echo "  created"
fi

cat <<EOF

SSM parameters written:
  /play/auth/google-client-id     (String)
  /play/auth/google-client-secret (SecureString)
  /play/auth/callback-urls        (String)  $CALLBACK_URLS
  /play/auth/logout-urls          (String)  $LOGOUT_URLS

Identity provider configured on the imported user pool.

Two steps left.

1. Let the app client offer Google, and set the URLs it may return to:

     node services/api/scripts/set-auth-urls.mjs \
       --google --stage=$STAGE --profile=$PROFILE \
       --callback-urls="$CALLBACK_URLS" --logout-urls="$LOGOUT_URLS"

2. In the Google Cloud Console, set these on your OAuth 2.0 Web client:
     Authorized JavaScript origins: https://$DOMAIN
     Authorized redirect URIs:      https://$DOMAIN/oauth2/idpresponse

Then refresh both apps' env, which is what tells them Google sign-in exists:

  npm run get-env -- --profile=$PROFILE --stage=$STAGE
EOF
