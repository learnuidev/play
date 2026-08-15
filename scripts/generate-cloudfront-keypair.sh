#!/usr/bin/env bash
#
# Generates a CloudFront key pair used for signed URLs (and, optionally,
# signed cookies). Produces:
#   - cloudfront_private.pem          (RSA private key)
#   - cloudfront_private_pkcs8.pem    (PKCS#8 private key, used by the backend)
#   - cloudfront_public.pem           (public key, for reference)
#
# Then prints the two values you must export before running `serverless deploy`:
#   CLOUDFRONT_PUBLIC_KEY  -> base64 of DER-encoded public key
#   CLOUDFRONT_PRIVATE_KEY -> base64 of PKCS#8 private key
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "Generating RSA key pair..."
openssl genrsa -out cloudfront_private.pem 2048
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in cloudfront_private.pem -out cloudfront_private_pkcs8.pem
openssl rsa -in cloudfront_private.pem -pubout -out cloudfront_public.pem

echo
echo "Add the following to your environment (or .env) before deploying:"
echo
printf 'export CLOUDFRONT_PUBLIC_KEY="%s"\n' \
  "$(openssl rsa -pubin -in cloudfront_public.pem -outform DER | base64 | tr -d '\n')"
printf 'export CLOUDFRONT_PRIVATE_KEY="%s"\n' \
  "$(base64 < cloudfront_private_pkcs8.pem | tr -d '\n')"
echo
echo "WARNING: treat cloudfront_private*.pem as a secret. Do not commit it."
