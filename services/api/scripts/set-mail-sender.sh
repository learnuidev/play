#!/usr/bin/env bash
#
# Sets up invitation email: verifies a sending address with SES and stores the
# configuration the backend reads.
#
#   /play/mail/from-address  (String) address invitations are sent from
#   /play/mail/app-base-url  (String) where an invitation email points
#
# The backend reads these and sends through
# Amazon SES. Nothing needs to live in .env or local environment files. With no
# from-address configured the service still works — invitations are created and
# the admin is handed the link to pass on — it just does not email anybody.
#
# Usage:
#   ./scripts/set-mail-sender.sh --from=you@example.com [options]
#
# Options:
#   --from=<address>     Address to send from (prompted if omitted)
#   --app-url=<url>      Where invitation emails point
#                        (default: http://localhost:3000)
#   --no-verify          Skip the SES identity verification step, for an
#                        address or domain that is already verified
#   --show               Print the current configuration and SES status, then exit
#   --delete             Remove the parameters (disables invitation email)
#   --stage=<name>       Backend stage  (default: dev)
#   --profile=<name>     AWS profile    (default: scripts/api-config.env)
#   --region=<name>      AWS region     (default: us-east-1)
#   --help               Show this help
set -euo pipefail

# The AWS profile is not written down here: `scripts/api-config.env` is the one
# place that names it, and an AWS_PROFILE in the environment wins over that file.
# shellcheck source=../../../scripts/api-config.env
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/scripts/api-config.env"
PROFILE="${AWS_PROFILE:-$API_AWS_PROFILE}"
REGION="us-east-1"
STAGE="dev"
FROM=""
APP_URL="http://localhost:3000"
VERIFY=true
SHOW=false
DELETE=false

usage() {
  # The header comment as written, minus the shebang and the `# ` that marks it:
  # every leading comment line, stopping at the first line of code. Reading it by
  # line number (as this used to) breaks the moment the comment changes length.
  awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from=*) FROM="${1#*=}" ;;
    --app-url=*) APP_URL="${1#*=}" ;;
    --no-verify) VERIFY=false ;;
    --show) SHOW=true ;;
    --delete) DELETE=true ;;
    --stage=*) STAGE="${1#*=}" ;;
    --profile=*) PROFILE="${1#*=}" ;;
    --region=*) REGION="${1#*=}" ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
  shift
done

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

# The SES sandbox is the single thing that most often makes "I never got the
# email" true, so it is reported rather than left to be discovered.
report_status() {
  echo
  echo "SES status (account $(aws_ sts get-caller-identity --query Account --output text)):"
  local sandbox
  sandbox="$(aws_ sesv2 get-account --query 'ProductionAccessEnabled' --output text 2>/dev/null || echo 'unknown')"
  if [[ "$sandbox" == "False" ]]; then
    echo "  Sandbox: ON — mail can only be sent TO verified addresses."
    echo "  Verify each recipient, or request production access:"
    echo "    aws sesv2 put-account-details --production-access-enabled \\"
    echo "      --mail-type TRANSACTIONAL --website-url <url> --use-case-optimization-opportunities"
  elif [[ "$sandbox" == "True" ]]; then
    echo "  Sandbox: OFF — mail can be sent to any address."
  else
    echo "  Sandbox: unknown (could not read the SES account)"
  fi
  echo "  Verified identities:"
  aws_ sesv2 list-email-identities \
    --query 'EmailIdentities[].[IdentityName,VerificationStatus]' --output text 2>/dev/null |
    sed 's/^/    /' || echo "    (none readable)"
}

if [[ "$SHOW" == true ]]; then
  echo "Configured values:"
  for name in from-address app-base-url; do
    value="$(aws_ ssm get-parameter --name "/play/mail/$name" --query 'Parameter.Value' --output text 2>/dev/null || echo '(unset)')"
    printf '  /play/mail/%-14s %s\n' "$name" "$value"
  done
  report_status
  exit 0
fi

if [[ "$DELETE" == true ]]; then
  for name in from-address app-base-url; do
    aws_ ssm delete-parameter --name "/play/mail/$name" >/dev/null 2>&1 || true
    echo "Deleted /play/mail/$name (if it existed)"
  done
  write_config "" ""
  echo
  echo "Redeploy so the Lambdas pick up the cleared address:"
  echo "  npm run deploy:api --workspace play-infra"
  exit 0
fi

# ## Where the values have to go now
#
# The mail settings used to be `${ssm:...}` interpolations in serverless.yml,
# read by Serverless at deploy time and baked into every Lambda's environment.
# The CDK app deliberately makes no AWS calls at synth — a lookup that misses
# does not fail, it writes the *parameter name* into a hundred environments — so
# the deploy-time values live in `infra/config/play-<stage>.json` instead.
#
# SSM is still written: it is the record, and it is what a fresh environment
# would be built from. But the file is what the deploy reads, so this script
# writes both. Leaving them to diverge is the one failure mode worth naming: a
# value in SSM and a different one in the config file looks like mail being sent
# from the wrong address for no reason.
write_config() {
  local from="$1" app_url="$2"
  local file
  file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/infra/config/play-$STAGE.json"

  if [[ ! -f "$file" ]]; then
    echo "  (no $file — run npm run import-state --workspace play-infra first)" >&2
    return 0
  fi

  node -e '
    const fs = require("fs");
    const [file, from, appUrl] = process.argv.slice(1);
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    config.mail = config.mail ?? {};
    config.mail.fromAddress = from;
    if (appUrl) config.mail.appBaseUrl = appUrl;
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  ' "$file" "$from" "$app_url"
}

if [[ -z "$FROM" ]]; then
  read -r -p "Send invitations from (verified email address or domain): " FROM
fi

if [[ -z "$FROM" ]]; then
  echo "A sending address is required." >&2
  exit 1
fi

if [[ "$VERIFY" == true ]]; then
  echo
  echo "Verifying $FROM with SES in $REGION..."
  if [[ "$FROM" == *@* ]]; then
    aws_ sesv2 create-email-identity --email-identity "$FROM" >/dev/null 2>&1 ||
      echo "  (already exists, or could not be created — continuing)"
    echo
    echo "  SES has emailed $FROM a verification link. Click it before inviting"
    echo "  anybody, or every send will fail with MessageRejected."
  else
    aws_ sesv2 create-email-identity --email-identity "$FROM" >/dev/null 2>&1 ||
      echo "  (already exists, or could not be created — continuing)"
    echo
    echo "  $FROM looks like a domain, so SES will return DKIM records to publish."
    echo "  Until they are live the identity stays 'FAILED' and sends are rejected."
    aws_ sesv2 get-email-identity --email-identity "$FROM" \
      --query 'DkimAttributes.Tokens' --output text 2>/dev/null |
      tr '\t' '\n' | sed 's/^/    CNAME token: /' || true
  fi
fi

echo
echo "Writing SSM parameters (profile: $PROFILE, region: $REGION)..."
aws_ ssm put-parameter --name /play/mail/from-address --type String \
  --value "$FROM" --overwrite >/dev/null
aws_ ssm put-parameter --name /play/mail/app-base-url --type String \
  --value "$APP_URL" --overwrite >/dev/null

write_config "$FROM" "$APP_URL" "marketplace"

cat <<EOF

SSM parameters written:
  /play/mail/from-address  $FROM
  /play/mail/app-base-url  $APP_URL

Deploy-time config written:
  infra/config/play-$STAGE.json   mail.fromAddress, mail.appBaseUrl
EOF

report_status

cat <<EOF

Then deploy the API, which is what puts them in the Lambdas' environment:
  npm run deploy:api --workspace play-infra

Note: --app-url is where an invitation link points. Set it to the deployed studio
before inviting people who are not on this machine, or every invitation will
point at localhost.
EOF
