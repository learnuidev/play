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
# Every place the apps are served is included by default: both of them on
# localhost (studio 3000, marketplace 3001) and both of them deployed — the
# studio on studio.lets-play.xyz, the marketplace on lets-play.xyz. One list
# covers all four because Amplify picks the entry matching the hostname the
# browser is on.
#
# Usage:
#   ./scripts/set-auth-urls.sh [options]
#
# Options:
#   --callback-urls=<urls>  comma-separated  (default: both apps, localhost + deployed)
#   --logout-urls=<urls>    comma-separated  (default: both apps, localhost + deployed)
#   --stage=<name>          Backend stage    (default: dev)
#   --profile=<name>        AWS profile      (default: scripts/api-config.env)
#   --region=<name>         AWS region       (default: us-east-1)
#   --show                  Print what is stored and exit
#   --delete                Remove the parameters, falling back to the defaults
#                           in serverless.yml
#   --help                  Show this help
set -euo pipefail

# The AWS profile is not written down here: `scripts/api-config.env` is the one
# place that names it, and an AWS_PROFILE in the environment wins over that file.
# shellcheck source=../../../scripts/api-config.env
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/scripts/api-config.env"
PROFILE="${AWS_PROFILE:-$API_AWS_PROFILE}"
REGION="us-east-1"
STAGE="dev"
CALLBACK_URLS="http://localhost:3000/auth/callback,http://localhost:3000,http://localhost:3001/auth/callback,http://localhost:3001,https://studio.lets-play.xyz/auth/callback,https://studio.lets-play.xyz,https://lets-play.xyz/auth/callback,https://lets-play.xyz"
LOGOUT_URLS="http://localhost:3000,http://localhost:3001,https://studio.lets-play.xyz,https://lets-play.xyz"
SHOW=false
DELETE=false

usage() {
  # The header comment as written, minus the shebang and the `# ` that marks it:
  # every leading comment line, stopping at the first line of code. Reading it by
  # line number used to work only while the comment kept its exact length.
  awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
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
