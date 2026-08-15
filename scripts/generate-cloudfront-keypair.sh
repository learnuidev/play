#!/usr/bin/env bash
#
# Generates a CloudFront key pair used for signed URLs and writes the key
# material to AWS SSM Parameter Store:
#
#   /play/cloudfront/private-key  (SecureString)  base64 of PKCS#8 private key
#   /play/cloudfront/public-key   (String)        PEM (BEGIN/END PUBLIC KEY) as CloudFront expects
#   /play/cloudfront/key-ref      (String)        short fingerprint for CallerReference
#
# The backend (serverless.yml) reads these parameters via ${ssm:...}, so no
# keys need to live in .env or local environment variables.
#
# Local PEM files are still written (cloudfront_*.pem) for backup/rotation.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

PROFILE="yoserverless"
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

PUB_PEM="$(cat cloudfront_public.pem)"
PRIV_B64="$(base64 < cloudfront_private_pkcs8.pem | tr -d '\n')"
KEY_REF="$(openssl rsa -pubin -in cloudfront_public.pem -outform DER | shasum -a 256 | cut -d' ' -f1 | cut -c1-16)"

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

aws ssm put-parameter \
  --name /play/cloudfront/key-ref \
  --type String \
  --value "$KEY_REF" \
  --overwrite \
  --profile "$PROFILE" \
  --region "$REGION" >/dev/null

echo
echo "SSM parameters written:"
echo "  /play/cloudfront/private-key (SecureString)"
echo "  /play/cloudfront/public-key  (String)"
echo "  /play/cloudfront/key-ref     (String) = $KEY_REF"
echo
echo "Now run: serverless deploy --aws-profile $PROFILE --region $REGION"
echo
echo "WARNING: treat cloudfront_private*.pem as a secret. Do not commit it."
