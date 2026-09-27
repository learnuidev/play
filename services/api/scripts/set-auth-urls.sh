#!/usr/bin/env bash
#
# Sets the URLs Cognito is allowed to send a signed-in browser back to:
#
#   /play/auth/callback-urls   (String)  comma-separated callback URLs
#   /play/auth/logout-urls     (String)  comma-separated logout URLs
#
# These live in SSM because the app client's OAuth settings are built from them
# at deploy time, and they are the one part of the auth configuration that
# changes with *where* the apps are served rather than with who signs in. The
# backend holds a default for local development (see `custom.authDefaults` in
# serverless.yml), but a value in SSM wins over it — so once this has been run
# even once, a new app or a new port has to be added here too, or Cognito will
# refuse the redirect with `redirect_mismatch`.
#
# Both apps are included by default: Play Studio on 3000 and Play Marketplace on
# 3001, and both sign in against the same user pool.
#
# Usage:
#   ./scripts/set-auth-urls.sh [options]
#
# Options:
#   --callback-urls=<urls>  comma-separated  (default: both apps on localhost)
#   --logout-urls=<urls>    comma-separated  (default: both apps on localhost)
#   --stage=<name>          Backend stage    (default: dev)
#   --profile=<name>        AWS profile      (default: yoserverless)
#   --region=<name>         AWS region       (default: us-east-1)
#   --show                  Print what is stored and exit
#   --delete                Remove the parameters, falling back to the defaults
#                           in serverless.yml
#   --help                  Show this help
set -euo pipefail

PROFILE="yoserverless"
REGION="us-east-1"
STAGE="dev"
CALLBACK_URLS="http://localhost:3000/auth/callback,http://localhost:3000,http://localhost:3001/auth/callback,http://localhost:3001"
LOGOUT_URLS="http://localhost:3000,http://localhost:3001"
SHOW=false
DELETE=false

usage() {
  sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --callback-urls=*) CALLBACK_URLS="${1#*=}" ;;
    --logout-urls=*) LOGOUT_URLS="${1#*=}" ;;
    --stage=*) STAGE="${1#*=}" ;;
    --profile=*) PROFILE="${1#*=}" ;;
    --region=*) REGION="${1#*=}" ;;
    --show) SHOW=true ;;
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

aws_() {
  aws "$@" --profile "$PROFILE" --region "$REGION"
}

if [[ "$SHOW" == true ]]; then
  for name in callback-urls logout-urls; do
    printf '%-28s ' "/play/auth/$name"
    aws_ ssm get-parameter --name "/play/auth/$name" --query Parameter.Value --output text 2>/dev/null ||
      echo "(not set — serverless.yml defaults apply)"
  done
  exit 0
fi

if [[ "$DELETE" == true ]]; then
  for name in callback-urls logout-urls; do
    aws_ ssm delete-parameter --name "/play/auth/$name" >/dev/null 2>&1 || true
    echo "Deleted /play/auth/$name (if it existed)"
  done
  echo
  echo "Deploy to fall back to custom.authDefaults in serverless.yml:"
  echo "  npm run deploy --workspace play-backend -- --stage $STAGE --aws-profile $PROFILE --region $REGION"
  exit 0
fi

echo "Writing SSM parameters (profile: $PROFILE, region: $REGION)..."
aws_ ssm put-parameter --name /play/auth/callback-urls --type String \
  --value "$CALLBACK_URLS" --overwrite >/dev/null
aws_ ssm put-parameter --name /play/auth/logout-urls --type String \
  --value "$LOGOUT_URLS" --overwrite >/dev/null

cat <<EOF

SSM parameters written:
  /play/auth/callback-urls  $CALLBACK_URLS
  /play/auth/logout-urls    $LOGOUT_URLS

Cognito only learns these at deploy time, so the app client still holds the old
list until you deploy:

  npm run deploy --workspace play-backend -- --stage $STAGE --aws-profile $PROFILE --region $REGION

After that, check what the pool actually accepts:

  aws cognito-idp describe-user-pool-client \\
    --user-pool-id <pool id> --client-id <client id> \\
    --profile $PROFILE --region $REGION \\
    --query 'UserPoolClient.CallbackURLs'
EOF
