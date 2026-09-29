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

  The **public** key is a CloudFront resource, and PlayMediaStack imports it
  rather than managing it. Applying a new one is an API call against the
  distribution's key group:

    aws cloudfront get-public-key --id <public key id> \
      --profile $PROFILE --region $REGION --query 'ETag' --output text
    aws cloudfront update-public-key --id <public key id> --if-match <etag> \
      --public-key-config 'Name=play-videos-public-key-$STAGE,CallerReference=play-videos-public-key-$STAGE,EncodedKey=<base64>' \
      --profile $PROFILE --region $REGION

  The public key id and the distribution id are in infra/config/play-$STAGE.json.

Until both are done, the browser's signed URLs will not validate — which looks
like a player that loads and never starts.
EOF
echo
echo "WARNING: treat cloudfront_private*.pem as a secret. Do not commit it."
