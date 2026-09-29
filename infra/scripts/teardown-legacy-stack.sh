#!/usr/bin/env bash
#
# Deletes the legacy Serverless Framework stack — and nothing else.
#
# The old `play-backend-<stage>` stack still owns every table, the videos
# bucket, the CloudFront distribution and the Cognito user pool. The CDK app
# *imports* all of them, which means it does not manage them — so deleting this
# stack the ordinary way would take the product with it: 23 tables of courses,
# lessons, memberships and credentials, and a user pool holding every account.
#
# `--retain-resources` is the way out. It names resources CloudFormation should
# leave in place when the stack goes: they are removed from the stack's
# management without being deleted, so the tables keep their data, the pool keeps
# its accounts, and the CDK stacks that already reference them by name carry on.
# Nothing about those resources changes. What changes is who is responsible for
# them, and afterwards the answer is "nobody, until phase E of
# docs/migration.md" — which is the state the CDK app is written to describe.
#
# What is *not* retained is the API, the functions, the methods and the
# deployment bucket. Those are stateless, they are what the migration replaced,
# and keeping them would be keeping the old API up.
#
# ## Before running this
#
#   1. The CDK stacks are deployed and the apps point at the new API URL.
#   2. `node infra/scripts/adopt-cognito.mjs` has run. The pool's pre sign-up
#      trigger is a Lambda in this stack; deleting it without repointing the
#      trigger stops sign-up working, and nothing about that failure looks like
#      a deleted stack.
#   3. You have read the retained-resource list below. It is the last chance to.
#
# The script checks (1) and (2) and refuses if either is missing. `--plan` shows
# (3) without doing anything.
#
# Usage:
#   ./infra/scripts/teardown-legacy-stack.sh [options]
#
# Options:
#   --stage=<name>       Backend stage    (default: dev)
#   --profile=<name>     AWS profile      (default: scripts/api-config.env)
#   --region=<name>      AWS region       (default: us-east-1)
#   --legacy-stack=<n>   Stack to remove  (default: play-backend-<stage>)
#   --plan               Print what would be retained and removed, change nothing
#   --yes                Skip the typed confirmation
#   --help               Show this help
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT/scripts/api-config.env"
PROFILE="${AWS_PROFILE:-$API_AWS_PROFILE}"
REGION="us-east-1"
STAGE="dev"
PLAN=false
ASSUME_YES=false

usage() {
  awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage=*) STAGE="${1#*=}" ;;
    --profile=*) PROFILE="${1#*=}" ;;
    --region=*) REGION="${1#*=}" ;;
    --legacy-stack=*) LEGACY_STACK="${1#*=}" ;;
    --plan) PLAN=true ;;
    --yes) ASSUME_YES=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit 1 ;;
  esac
  shift
done

LEGACY_STACK="${LEGACY_STACK:-play-backend-$STAGE}"
CONFIG="$ROOT/infra/config/play-$STAGE.json"

aws_() { aws "$@" --profile "$PROFILE" --region "$REGION"; }

# Resource types this script retains, and why each one is on the list.
#
# By *type* rather than by name: the names are exactly the thing a regenerated
# table changes, and a name quietly missing from a hardcoded list would be a
# table deleted by the script whose whole job is not to delete tables.
#
#   DynamoDB tables          every course, lesson, membership, comment, credential
#   S3 buckets               every uploaded and processed video, and the CDN logs
#   S3 bucket policy         CloudFront's permission to read the videos — declared
#                            in PlayMediaStack, and lost with the stack otherwise
#   CloudFront pieces        the distribution, its key group and its public key: a
#                            new distribution is a new domain in every player
#   Cognito pieces           every account, including the federated ones
#   Custom::S3               the bucket's notification configuration, which
#                            PlayApiStack set. Deleting it wipes that
#                            configuration, after which uploads stop being
#                            processed — silently, because nothing errors
RETAINED_TYPES=(
  "AWS::DynamoDB::Table"
  "AWS::S3::Bucket"
  "AWS::S3::BucketPolicy"
  "AWS::CloudFront::Distribution"
  "AWS::CloudFront::KeyGroup"
  "AWS::CloudFront::PublicKey"
  "AWS::CloudFront::OriginAccessControl"
  "AWS::Cognito::UserPool"
  "AWS::Cognito::UserPoolClient"
  "AWS::Cognito::UserPoolDomain"
  "AWS::Cognito::UserPoolIdentityProvider"
  "Custom::S3"
)

# The one exception to the list above, and the only resource here whose deletion
# is wanted: Serverless's own deployment bucket, which holds the zipped handlers
# of a stack that is being removed. It carries no product data, and retaining it
# would leave a bucket of dead artifacts that nothing will ever empty.
RETAINED_EXCEPTIONS=(
  "ServerlessDeploymentBucket"
  "ServerlessDeploymentBucketPolicy"
)

echo "Legacy stack: $LEGACY_STACK (profile: $PROFILE, region: $REGION)"

if ! aws_ cloudformation describe-stacks --stack-name "$LEGACY_STACK" >/dev/null 2>&1; then
  echo "No such stack — it has already gone."
  exit 0
fi

# --- the guards ---------------------------------------------------------------

for stack in "PlayApiStack-$STAGE" "PlayAuthStack-$STAGE"; do
  if ! aws_ cloudformation describe-stacks --stack-name "$stack" >/dev/null 2>&1; then
    echo "Refusing: $stack does not exist. Deploy the CDK stacks first." >&2
    exit 1
  fi
done

output() {
  aws_ cloudformation describe-stacks --stack-name "PlayAuthStack-$STAGE" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

POOL_ID="$(output CognitoUserPoolId)"
TRIGGER_ARN="$(output LinkFederatedUserFunctionArn)"
POOL_TRIGGER="$(aws_ cognito-idp describe-user-pool --user-pool-id "$POOL_ID" \
  --query 'UserPool.LambdaConfig.PreSignUp' --output text 2>/dev/null || true)"

if [[ "$POOL_TRIGGER" != "$TRIGGER_ARN" ]]; then
  cat >&2 <<EOF
Refusing: the user pool's pre sign-up trigger is not the CDK function.

  pool trigger   ${POOL_TRIGGER:-(not set)}
  CDK function   $TRIGGER_ARN

The trigger currently points into the stack you are about to delete. Deleting it
would leave Cognito calling a function that no longer exists, and the symptom is
not an error in a log — it is people unable to sign up.

Fix it first:

  node infra/scripts/adopt-cognito.mjs --stage=$STAGE --profile=$PROFILE
EOF
  exit 1
fi
echo "Pre sign-up trigger points at the CDK function."

# --- what to retain -----------------------------------------------------------

# `list-stack-resources` rather than `describe-stack-resources`, which silently
# truncates at 100 resources on a stack this size and returns no NextToken.
# `--retain-resources` accepts only resources in the *root* stack, and every
# resource on the list above is one: the nested stacks hold functions and methods
# and nothing else.
RETAIN=()
for type in "${RETAINED_TYPES[@]}"; do
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    for excluded in "${RETAINED_EXCEPTIONS[@]}"; do
      [[ "$id" == "$excluded" ]] && continue 2
    done
    RETAIN+=("$id")
  done < <(aws_ cloudformation list-stack-resources --stack-name "$LEGACY_STACK" \
    --query "StackResourceSummaries[?ResourceType=='$type'].LogicalResourceId" \
    --output text | tr '\t' '\n' | sort)
done

# Counted by listing rather than with a `length` query: the CLI paginates this
# call at 100 resources and applies the query to each page, so `length` answers
# "100, 100, 100, 100, 100" for a stack of 500 and any arithmetic on it is wrong.
TOTAL="$(aws_ cloudformation list-stack-resources --stack-name "$LEGACY_STACK" \
  --query 'StackResourceSummaries[].LogicalResourceId' --output text \
  | tr '\t' '\n' | grep -c . || true)"

if [[ ${#RETAIN[@]} -eq 0 ]]; then
  echo "Refusing: found no resources to retain, which cannot be right for this stack." >&2
  echo "Check that '$LEGACY_STACK' is the legacy Serverless stack." >&2
  exit 1
fi

echo
echo "$LEGACY_STACK holds $TOTAL root-stack resources."
echo "${#RETAIN[@]} of them are retained — left in place, unmanaged by CloudFormation:"
for id in "${RETAIN[@]}"; do echo "  retain  $id"; done

if [[ "$PLAN" == true ]]; then
  echo
  echo "--plan: nothing was changed."
  exit 0
fi

if [[ "$ASSUME_YES" != true ]]; then
  cat <<EOF

Everything else is deleted: the REST API, the 134 functions, the methods, the
execution role and the 65 nested stacks that hold the newer of those functions.

Type the stack name to continue:
EOF
  read -r confirmation
  if [[ "$confirmation" != "$LEGACY_STACK" ]]; then
    echo "Aborted — '$confirmation' is not '$LEGACY_STACK'." >&2
    exit 1
  fi
fi

echo
echo "Deleting $LEGACY_STACK..."
aws_ cloudformation delete-stack --stack-name "$LEGACY_STACK" --retain-resources "${RETAIN[@]}"
aws_ cloudformation wait stack-delete-complete --stack-name "$LEGACY_STACK"

# --- verify -------------------------------------------------------------------
#
# The tables are the ones that matter, so they are the ones checked by name:
# the physical names are in the config file, which is the same list the CDK app
# imports from. Everything else is checked by whether AWS still answers for it.

echo
echo "Verifying what was meant to survive:"
FAILURES=0

while IFS=$'\t' read -r logical name; do
  [[ -z "$logical" ]] && continue
  status="$(aws_ dynamodb describe-table --table-name "$name" \
    --query 'Table.TableStatus' --output text 2>/dev/null || echo MISSING)"
  printf '  %-30s %s\n' "$logical" "$status"
  [[ "$status" == "ACTIVE" ]] || FAILURES=$((FAILURES + 1))
done < <(node -e '
  const c = require(process.argv[1]);
  for (const [id, name] of Object.entries(c.existing.tables)) console.log(`${id}\t${name}`);
' "$CONFIG")

check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  %-30s %s\n' "$label" "present"
  else
    printf '  %-30s %s\n' "$label" "MISSING"
    FAILURES=$((FAILURES + 1))
  fi
}

BUCKET="$(node -e 'process.stdout.write(require(process.argv[1]).existing.videosBucket)' "$CONFIG")"
POOL="$(node -e 'process.stdout.write(require(process.argv[1]).existing.userPoolId)' "$CONFIG")"
DIST="$(node -e 'process.stdout.write(require(process.argv[1]).existing.cloudFrontDistributionId)' "$CONFIG")"

check "VideosBucket" aws_ s3api get-bucket-location --bucket "$BUCKET"
check "CognitoUserPool" aws_ cognito-idp describe-user-pool --user-pool-id "$POOL"
check "VideoDistribution" aws_ cloudfront get-distribution --id "$DIST"

# The notification configuration is the one that fails quietly: put back by
# PlayApiStack, and wiped if the retained marker did not do its job.
NOTIFICATIONS="$(aws_ s3api get-bucket-notification-configuration --bucket "$BUCKET" \
  --query 'length(LambdaFunctionConfigurations)' --output text 2>/dev/null || echo 0)"
printf '  %-30s %s\n' "S3 notifications" "$NOTIFICATIONS (expect 1)"
[[ "$NOTIFICATIONS" == "1" ]] || FAILURES=$((FAILURES + 1))

cat <<EOF

The legacy stack is gone, and the resources above are unmanaged: nothing will
notice if one is deleted, and nothing will recreate it. If you want the tables
under CloudFormation's care, that is phase E of docs/migration.md — and it means
copying the data into new tables rather than adopting these.

Point-in-time recovery is worth turning on for the tables whose loss would be
more than an inconvenience. It is an in-place change and does not touch the data:

  aws dynamodb update-continuous-backups --table-name <name> \\
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \\
    --profile $PROFILE --region $REGION
EOF

if [[ "$FAILURES" -gt 0 ]]; then
  echo
  echo "WARNING: $FAILURES retained resource(s) did not verify. Look before doing anything else." >&2
  exit 1
fi
