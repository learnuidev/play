#!/usr/bin/env bash
#
# Generates a CloudFront key pair used for signed URLs and writes the key
# material to AWS SSM Parameter Store:
#
#   /play/cloudfront/private-key  (SecureString)  base64 of PKCS#8 private key
#   /play/cloudfront/public-key   (String)        PEM (BEGIN/END PUBLIC KEY) as CloudFront expects
#
# The Lambdas read the private key from SSM at runtime, by name rather than by
# value, and cache it for the life of the container (`lib/cloudfront-key`). That
# is deliberate: the key is 2.3 KB, and interpolating it into every function's
# environment was most of Lambda's 4 KB budget and a private key readable from
# the console in a hundred places that never sign anything.
#
# Local PEM files are still written (cloudfront_*.pem) for backup/rotation.
#
# Writing the parameters is not the whole job — nothing is signed with them until
# CloudFront's public key is updated and the Lambda containers that hold the old
# private key are gone. The note this script ends with says how.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# The AWS profile is not written down here: `scripts/api-config.env` is the one
# place that names it, and an AWS_PROFILE in the environment wins over that file.
# shellcheck source=../../../scripts/api-config.env
. "$DIR/../../scripts/api-config.env"
PROFILE="${AWS_PROFILE:-$API_AWS_PROFILE}"
REGION="us-east-1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile=*) PROFILE="${1#*=}" ;;
    --region=*) REGION="${1#*=}" ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--profile=<aws-profile>] [--region=<aws-region>]" >&2
      exit 1
      ;;
  esac
  shift
done

echo "Generating RSA key pair..."
openssl genrsa -out cloudfront_private.pem 2048
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in cloudfront_private.pem -out cloudfront_private_pkcs8.pem
openssl rsa -in cloudfront_private.pem -pubout -out cloudfront_public.pem

PUB_PEM="$(cat cloudfront_public.pem; printf 'SENTINEL')"
PUB_PEM="${PUB_PEM%SENTINEL}"
PRIV_B64="$(base64 < cloudfront_private_pkcs8.pem | tr -d '\n')"

echo
echo "Writing keys to SSM (profile: $PROFILE, region: $REGION)..."
aws ssm put-parameter \
  --name /play/cloudfront/private-key \
  --type SecureString \
  --value "$PRIV_B64" \
  --overwrite \
  --profile "$PROFILE" \
  --region "$REGION" >/dev/null

aws ssm put-parameter \
  --name /play/cloudfront/public-key \
  --type String \
  --value "$PUB_PEM" \
  --overwrite \
  --profile "$PROFILE" \
  --region "$REGION" >/dev/null

echo
echo "SSM parameters written:"
echo "  /play/cloudfront/private-key (SecureString)"
echo "  /play/cloudfront/public-key  (String)"
echo
cat <<EOF

The key pair is in SSM. Two things apply it, and neither is a deploy.

  The **private** key is read by the Lambdas at runtime, by name, and cached for
  the life of the container (lib/cloudfront-key). A rotation therefore does not
  take effect until the containers that signed a URL with the old key are gone —
  a redeploy of the API stack is the reliable way to make that immediate:

    npm run deploy:api --workspace play-infra

  The **public** key is a CloudFront resource, and CloudFront will not change one:
  \`update-public-key\` answers "you cannot modify encoded material and name of a
  public key once created", so a rotation creates a *new* public key and moves the
  key group the distribution trusts to it. On a stage whose media the stacks
  create, none of that is typed by hand — the key is a resource in PlayMediaStack,
  so the rotation is three edits and a deploy:

    - write the new pair at new parameter names (or with put-parameter)
    - bump cloudFrontKeyVersion in infra/config/play-\$STAGE.json
    - npm run deploy:media --workspace play-infra  (or cdk deploy PlayMediaStack-\$STAGE)

  That deploy creates the new key, moves the key group to it, deletes the old key,
  and rewrites the id parameter the handlers read — so the API stack does not have
  to be deployed at all. CloudFront refuses a key group that a distribution still
  trusts, so the group is updated in place rather than replaced: nothing about the
  distribution changes, and no URL changes with it.

  A stage that **imports** its distribution — dev — is the exception, because its
  key group belongs to the legacy stack rather than to PlayMediaStack. There the
  rotation is the API calls above by hand, against the key group id in
  \`aws cloudfront get-distribution-config\`: create-public-key, then
  update-key-group with the new key in its items.

Until the public half is in place and the old containers are gone, the browser's
signed URLs will not validate — which looks like a player that loads and never
starts.
EOF
echo
echo "WARNING: treat cloudfront_private*.pem as a secret. Do not commit it."
