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
# The backend (serverless.yml) reads these via ${ssm:...} and creates the Cognito
# Google identity provider, the Hosted UI domain, and the app client's OAuth
# settings from them. Nothing needs to live in .env or local environment files.
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
#   --callback-urls=<urls>  comma-separated              (default: localhost:3000)
#   --logout-urls=<urls>    comma-separated              (default: localhost:3000)
#   --stage=<name>          Backend stage                (default: dev)
#   --profile=<name>        AWS profile                  (default: yoserverless)
#   --region=<name>         AWS region                   (default: us-east-1)
#   --delete                Remove the parameters (disables Google sign-in)
#   --help                  Show this help
set -euo pipefail

PROFILE="yoserverless"
REGION="us-east-1"
STAGE="dev"
CLIENT_ID=""
CLIENT_SECRET=""
CALLBACK_URLS="http://localhost:3000/auth/callback,http://localhost:3000"
LOGOUT_URLS="http://localhost:3000"
DELETE=false

usage() {
  sed -n '2,38p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
  echo
  echo "Redeploy to drop the Google identity provider and Hosted UI domain:"
  echo "  serverless deploy --stage $STAGE --aws-profile $PROFILE --region $REGION"
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

cat <<EOF

SSM parameters written:
  /play/auth/google-client-id     (String)
  /play/auth/google-client-secret (SecureString)
  /play/auth/callback-urls        (String)  $CALLBACK_URLS
  /play/auth/logout-urls          (String)  $LOGOUT_URLS

Now in the Google Cloud Console, set these on your OAuth 2.0 Web client:
  Authorized JavaScript origins: https://$DOMAIN
  Authorized redirect URIs:      https://$DOMAIN/oauth2/idpresponse

Then deploy and refresh the frontend env:
  cd play-backend  && serverless deploy --stage $STAGE --aws-profile $PROFILE --region $REGION
  cd play-frontend && npm run get-env -- --profile=$PROFILE --stage=$STAGE
EOF
