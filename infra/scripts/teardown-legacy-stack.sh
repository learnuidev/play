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
# ## How the resources are kept
#
# `DeletionPolicy: Retain`, applied to the stack's template by
# `infra/scripts/retain-legacy-resources.mjs`. `Retain` means CloudFormation
# leaves the resource in place when the stack goes and simply stops managing it,
# which is exactly the state the CDK app is written for: it references all of
# these by name and never creates them.
#
# This script **checks that the policy is in place and refuses to run without
# it.** That check is the whole safety story, because the two obvious ways to get
# this wrong are both silent:
#
#   - `aws cloudformation delete-stack --retain-resources …` looks like the
#     answer and is not. It is only valid for a stack already in `DELETE_FAILED`
#     — it is the retry path for a deletion that failed, not a way to say "keep
#     these". Against a healthy stack CloudFormation rejects the call outright.
#   - A plain `delete-stack` on a stack with no deletion policies deletes
#     everything, and reports success.
#
# Run the retain script first:
#
#   node infra/scripts/retain-legacy-resources.mjs
#
# ## Before running this
#
#   1. The CDK stacks are deployed and the apps point at the new API URL.
#   2. `node infra/scripts/adopt-cognito.mjs` has run. The pool's pre sign-up
#      trigger is a Lambda in this stack; deleting it without repointing the
#      trigger stops sign-up working, and nothing about that failure looks like
#      a deleted stack.
#   3. The apps have been used against the new API — signing in, and playing a
#      lesson. This is the last step that cannot be undone, and the old API is
#      the only rollback there is.
#
# The script checks (1) and (2) and refuses if either is missing. (3) is yours.
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
RETAIN="$ROOT/infra/scripts/retain-legacy-resources.mjs"

aws_() { aws "$@" --profile "$PROFILE" --region "$REGION"; }

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

# The check that matters. Without DeletionPolicy: Retain on the resources that
# hold state, the command below deletes the product.
if ! node "$RETAIN" --check --stage="$STAGE" --profile="$PROFILE" --region="$REGION"; then
  cat >&2 <<EOF

Refusing: the stateful resources in $LEGACY_STACK are not marked Retain, so
deleting this stack would delete them — 23 tables of courses, lessons,
memberships and credentials, and a user pool holding every account.

Look at it, apply it, then come back:

  node infra/scripts/retain-legacy-resources.mjs --stage=$STAGE --plan
  node infra/scripts/retain-legacy-resources.mjs --stage=$STAGE
EOF
  exit 1
fi

# --- what stays, and what goes ------------------------------------------------

# Counted by listing rather than with a `length` query: the CLI paginates this
# call at 100 resources and applies the query to each page, so a `length` answer
# for a stack of 500 comes back as five separate hundreds.
TOTAL="$(aws_ cloudformation list-stack-resources --stack-name "$LEGACY_STACK" \
  --query 'StackResourceSummaries[].LogicalResourceId' --output text \
  | tr '\t' '\n' | grep -c . || true)"

TEMPLATE_FILE="$(mktemp)"
trap 'rm -f "$TEMPLATE_FILE"' EXIT
aws_ cloudformation get-template --stack-name "$LEGACY_STACK" --output json > "$TEMPLATE_FILE"

RETAINED_LIST="$(node -e '
  const fs = require("node:fs");
  const template = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const [id, resource] of Object.entries(template.TemplateBody.Resources ?? {})) {
    if (resource.DeletionPolicy === "Retain") console.log(id);
  }
' "$TEMPLATE_FILE")"

RETAINED="$(printf '%s\n' "$RETAINED_LIST" | grep -c . || true)"

echo
echo "$LEGACY_STACK holds $TOTAL root-stack resources."
echo "$RETAINED of them are marked Retain — left in place, unmanaged by CloudFormation:"
printf '%s\n' "$RETAINED_LIST" | sed 's/^/  retain  /'

if [[ "$PLAN" == true ]]; then
  echo
  echo "--plan: nothing was changed."
  exit 0
fi

if [[ "$ASSUME_YES" != true ]]; then
  cat <<EOF

Everything else is deleted: the REST API, the 134 functions, the methods, the
execution role, the 65 nested stacks that hold the newer of those functions, and
Serverless's deployment bucket.

Type the stack name to continue:
EOF
  read -r confirmation
  if [[ "$confirmation" != "$LEGACY_STACK" ]]; then
    echo "Aborted — '$confirmation' is not '$LEGACY_STACK'." >&2
    exit 1
  fi
fi

# --- empty the buckets that are about to be deleted ---------------------------
#
# S3 refuses to delete a bucket that has anything in it. Serverless's own
# deployment bucket is the one bucket this stack deletes rather than retains —
# it holds the zipped handlers of the very stack being removed — and it has 1.2 GB
# in it. Without this, `delete-stack` runs, deletes everything else, and fails on
# that one resource with `DELETE_FAILED`, which needs a second pass to clear.
#
# Only buckets *without* the retention policy are touched. Emptying a retained
# one would be the data loss this whole script exists to prevent.

EMPTY_BUCKETS="$(node -e '
  const fs = require("node:fs");
  const template = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const [id, resource] of Object.entries(template.TemplateBody.Resources ?? {})) {
    if (resource.Type === "AWS::S3::Bucket" && resource.DeletionPolicy !== "Retain") {
      console.log(id);
    }
  }
' "$TEMPLATE_FILE")"

for logical in $EMPTY_BUCKETS; do
  name="$(node -e '
    const fs = require("node:fs");
    const template = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const resource = template.TemplateBody.Resources[process.argv[2]] ?? {};
    process.stdout.write(String(resource.Properties?.BucketName ?? ""));
  ' "$TEMPLATE_FILE" "$logical")"

  if [[ -z "$name" ]]; then
    # The name is generated, so read it from the stack's outputs instead — which
    # is where this deployment has always recorded it.
    name="$(aws_ cloudformation describe-stacks --stack-name "$LEGACY_STACK" \
      --query "Stacks[0].Outputs[?OutputKey=='ServerlessDeploymentBucketName'].OutputValue" \
      --output text)"
  fi

  [[ -z "$name" || "$name" == "None" ]] && continue

  objects="$(aws_ s3 ls "s3://$name" --recursive 2>/dev/null | wc -l | tr -d ' ')"
  echo
  echo "Emptying $logical ($name): $objects object(s), about to be deleted with the stack"

  if [[ "$objects" != "0" ]]; then
    aws_ s3 rm "s3://$name" --recursive --only-show-errors
  fi

  # A versioned bucket keeps its objects after `rm`, and refuses to be deleted
  # just the same.
  versions="$(aws_ s3api list-object-versions --bucket "$name" --output json 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(String((j.Versions??[]).length+(j.DeleteMarkers??[]).length))}catch{process.stdout.write("0")}})' 2>/dev/null || echo 0)"

  if [[ "$versions" != "0" ]]; then
    echo "  (versioned: removing $versions version(s) too)"
    aws_ s3api delete-objects --bucket "$name" --delete "$(aws_ s3api list-object-versions \
      --bucket "$name" --query '{Objects: [].{Key:Key,VersionId:VersionId}}' --output json \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(JSON.stringify({Objects:(j.Objects??[]).filter(o=>o.Key)}))})')" >/dev/null 2>&1 || true
  fi
done

# --- delete -------------------------------------------------------------------
#
# A plain delete. The deletion policies are what keep the stateful resources, and
# there is no flag here that could accidentally change that.

echo
echo "Deleting $LEGACY_STACK..."
aws_ cloudformation delete-stack --stack-name "$LEGACY_STACK"

if ! aws_ cloudformation wait stack-delete-complete --stack-name "$LEGACY_STACK" 2>/dev/null; then
  # A deletion that fails does not roll back — the stack stops in DELETE_FAILED
  # with most of itself already gone and one or two resources still there. The
  # reason is recorded per resource, so print it rather than the waiter's message
  # about a terminal state.
  cat >&2 <<EOF

Deletion did not finish. $LEGACY_STACK is in DELETE_FAILED, which is a stack
that has mostly been deleted and is waiting for the resource(s) that blocked it:

EOF
  aws_ cloudformation list-stack-resources --stack-name "$LEGACY_STACK" \
    --query "StackResourceSummaries[?ResourceStatus=='DELETE_FAILED'].[LogicalResourceId,ResourceType,ResourceStatusReason]" \
    --output text 2>/dev/null | sed 's/^/  /' >&2

  cat >&2 <<EOF

Everything retained is untouched — the deletion policies were in place before
this ran, so nothing that holds state was at risk. Clear whatever blocked it and
run this script again: it will finish the deletion.
EOF
  exit 1
fi

# --- verify -------------------------------------------------------------------
#
# Against AWS, not against the plan. The tables are checked by name, from the
# config file the CDK app imports them by; everything else by whether AWS still
# answers for it.

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

# The S3 notification is the one that fails quietly: set by PlayApiStack, and
# wiped if the retained marker did not do its job.
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
