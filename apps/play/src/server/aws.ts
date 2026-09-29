import { lastMeaningfulLines, run } from "./exec";
import type { Identity, StackSummary } from "@/lib/types";

/**
 * The AWS CLI, as a typed function or two.
 *
 * The console talks to AWS the way every other script in this repository does —
 * through `aws`, with a `--profile` and a `--region` on every call — rather
 * than by taking an SDK as a dependency. Two reasons, and the second is the one
 * that decided it:
 *
 * - The profile is already the repository's unit of identity.
 *   `scripts/api-config.env` names it, and `cdk` takes it from `AWS_PROFILE`.
 *   An SDK client would need the credentials resolved a second way, and the two
 *   ways could disagree.
 * - Every call here is a `describe`, a `list` or a `get`. There is nothing to
 *   write, and a read is exactly what a CLI invocation is good at.
 */

export interface AwsContext {
  profile: string;
  region: string;
}

interface AwsOptions extends Partial<AwsContext> {
  /** A missing resource is an answer, not an error — return null instead. */
  optional?: boolean;
}

/** Runs `aws … --output json` and parses it. */
export async function awsJson<T>(
  argv: string[],
  options: AwsOptions = {},
): Promise<T | null> {
  const { profile, region, optional } = options;
  const args = [
    ...argv,
    ...(profile ? ["--profile", profile] : []),
    ...(region ? ["--region", region] : []),
    "--output",
    "json",
  ];

  // A CLI that is not installed throws rather than exiting non-zero, and for a
  // read that is the same answer as a resource that is not there.
  const result = await run("aws", args, { timeoutMs: 30_000 }).catch(() => null);

  if (!result || result.code !== 0) {
    if (optional) return null;
    const detail = result
      ? (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-3).join("\n")
      : "the AWS CLI could not be started";
    throw new Error(`aws ${argv.slice(0, 3).join(" ")} failed:\n${detail}`);
  }

  const text = result.stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (optional) return null;
    throw new Error(`aws ${argv.slice(0, 3).join(" ")} did not answer with JSON.`);
  }
}

/* ------------------------------------------------------------------ *
 * Who we are
 * ------------------------------------------------------------------ */

/**
 * What `sts get-caller-identity` actually prints.
 *
 * PascalCase, because that is the AWS wire format — and deliberately a private
 * interface rather than `Identity` from `@/lib/types`, which is the camelCase
 * shape the browser reads. Conflating the two is what broke a deploy, so they
 * are two types here and the conversion below is a line of code rather than an
 * act of faith.
 */
interface StsIdentity {
  UserId?: string;
  Account?: string;
  Arn?: string;
}

/**
 * The identity, converted at the boundary where the wire format is known.
 *
 * **`awsJson<T>` is an unchecked assertion** — it is `JSON.parse(text) as T`, and
 * TypeScript cannot tell a wrong `T` from a right one. So the conversion from
 * what the CLI prints to the shape the rest of this app expects has to be
 * written and executed, not merely declared.
 *
 * It was not, and it cost a deploy. `Identity` declares `account`, `arn` and
 * `userId`; the CLI answers with `Account`, `Arn` and `UserId`. So
 * `identity.account` was `undefined`, the account check compared `undefined`
 * against the config's account, and the plan refused to continue — correctly, on
 * input that was wrong. The chrome rendered `undefined · us-east-1` for the same
 * reason, which is the part that had been visible all along.
 *
 * `Account` and `Arn` are required *of the answer*: a value that is missing here
 * becomes a stack in the wrong account rather than a failed call.
 */
export async function getIdentity(
  ctx: Partial<AwsContext> = {},
): Promise<Identity | null> {
  const response = await awsJson<StsIdentity>(
    ["sts", "get-caller-identity"],
    { ...ctx, optional: true },
  );
  if (!response?.Account || !response.Arn) return null;

  return {
    account: response.Account,
    arn: response.Arn,
    userId: response.UserId ?? "",
  };
}

export async function identityError(ctx: Partial<AwsContext> = {}): Promise<string> {
  const result = await run(
    "aws",
    [
      "sts",
      "get-caller-identity",
      ...(ctx.profile ? ["--profile", ctx.profile] : []),
      ...(ctx.region ? ["--region", ctx.region] : []),
    ],
    { timeoutMs: 30_000 },
  ).catch((error: Error) => null);

  if (!result) return "The AWS CLI could not be started. Is it on this machine's PATH?";

  const detail = (result.stderr || result.stdout).trim().split("\n").slice(-2).join(" ");
  if (/SSO|sso/i.test(detail)) {
    return `The AWS SSO session for '${ctx.profile ?? "default"}' has expired. Run \`aws sso login\` and refresh.`;
  }
  if (/credentials/i.test(detail)) {
    return `No credentials for profile '${ctx.profile ?? "default"}'. Run \`aws sso login\` or configure the profile.`;
  }
  return detail || "AWS credentials could not be resolved.";
}

/* ------------------------------------------------------------------ *
 * Stacks
 * ------------------------------------------------------------------ */

/**
 * The four root stacks, and what each one is for.
 *
 * The purposes are deliberately neutral about importing: which of the first
 * three create their resources and which import them is `ownership` in the
 * environment's config, and it differs between a migrated stage and a new one.
 * The environment card says which this one does.
 */
export const ROOT_STACKS = [
  { suffix: "Data", purpose: "the DynamoDB tables" },
  { suffix: "Media", purpose: "the videos bucket and distribution" },
  { suffix: "Auth", purpose: "the Cognito user pool" },
  { suffix: "Api", purpose: "the functions, their routes, and the IAM" },
] as const;

export function rootStackNames(stage: string): string[] {
  return ROOT_STACKS.map(({ suffix }) => `Play${suffix}Stack-${stage}`);
}

/**
 * A stack is only healthy if it is *settled*.
 *
 * `UPDATE_ROLLBACK_COMPLETE` ends in `_COMPLETE` and is the opposite of
 * healthy: it means the last change was rolled back and the stack is sitting in
 * the state it had before it. A check that matched `_COMPLETE` would call a
 * failed deploy a success, which is the one mistake this console must not make.
 */
const SETTLED = new Set([
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "IMPORT_COMPLETE",
]);

export function stackHealthy(status: string): boolean {
  return SETTLED.has(status);
}

export function stackLabel(status: string): string {
  if (stackHealthy(status)) return "complete";
  if (status === "UPDATE_ROLLBACK_COMPLETE") return "rolled back";
  if (status === "ROLLBACK_COMPLETE") return "rolled back";
  if (status.endsWith("_IN_PROGRESS")) return "in progress";
  if (status.endsWith("_FAILED")) return "failed";
  return status.toLowerCase().replace(/_/g, " ");
}

interface DescribeStacksResponse {
  Stacks?: Array<{
    StackName: string;
    StackStatus: string;
    Outputs?: Array<{ OutputKey: string; OutputValue: string }>;
  }>;
}

export interface StackDetail {
  name: string;
  status: string;
  healthy: boolean;
  outputs: Record<string, string>;
}

/** One stack, with its outputs, or null when it does not exist yet. */
export async function describeStack(
  name: string,
  ctx: Partial<AwsContext> = {},
): Promise<StackDetail | null> {
  const response = await awsJson<DescribeStacksResponse>(
    ["cloudformation", "describe-stacks", "--stack-name", name],
    { ...ctx, optional: true },
  );
  const stack = response?.Stacks?.[0];
  if (!stack) return null;

  const outputs: Record<string, string> = {};
  for (const output of stack.Outputs ?? []) outputs[output.OutputKey] = output.OutputValue;

  return {
    name: stack.StackName,
    status: stack.StackStatus,
    healthy: stackHealthy(stack.StackStatus),
    outputs,
  };
}

/**
 * Whether a bucket name is free, already ours, or somebody else's.
 *
 * `HeadBucket` is the only way to ask, and it answers three ways: 200 for a
 * bucket this account can see, 404 for one that does not exist, and **403 for
 * one that exists in another account** — because S3's namespace is global, and
 * a bucket this account cannot see is a bucket this account cannot create.
 *
 * That last answer is worth asking for by name. CloudFormation reports it as
 * "Resource of type 'AWS::S3::Bucket' with identifier 'play-test-videos' already
 * exists" during change-set validation, which names the bucket and neither whose
 * it is nor what to do about it.
 */
export type BucketAccess = "free" | "ours" | "other" | "unknown";

export interface BucketAnswer {
  access: BucketAccess;
  /** The CLI's own words, when the answer was not one of the three. */
  detail: string | null;
}

export async function bucketAccess(
  bucket: string,
  ctx: Partial<AwsContext> = {},
): Promise<BucketAnswer> {
  const { profile, region } = ctx;
  const args = [
    "s3api",
    "head-bucket",
    "--bucket",
    bucket,
    ...(profile ? ["--profile", profile] : []),
    ...(region ? ["--region", region] : []),
  ];

  const result = await run("aws", args, { timeoutMs: 30_000 }).catch(() => null);
  if (!result) return { access: "unknown", detail: "the AWS CLI could not be started" };
  if (result.code === 0) return { access: "ours", detail: null };

  const stderr = result.stderr.trim();
  if (/404|NoSuchBucket|Not Found/i.test(stderr)) return { access: "free", detail: null };
  // A 403 is the global-namespace answer: somebody else holds the name. It can
  // also mean a policy denies this principal, which is the same outcome — this
  // account cannot create the bucket either way.
  if (/403|Forbidden|AccessDenied/i.test(stderr)) return { access: "other", detail: null };

  return {
    access: "unknown",
    detail: lastMeaningfulLines(stderr || result.stdout, 2).join(" ") || "no output",
  };
}

export async function describeStacks(
  names: string[],
  ctx: Partial<AwsContext> = {},
): Promise<StackDetail[]> {
  const details = await Promise.all(names.map((name) => describeStack(name, ctx)));
  return details.filter((detail): detail is StackDetail => detail !== null);
}

interface DescribeAllResponse {
  Stacks?: Array<{
    StackName: string;
    StackStatus: string;
    Outputs?: Array<{ OutputKey: string; OutputValue: string }>;
  }>;
}

/**
 * A stack, with what its template exported.
 *
 * `describe-stacks` with no `--stack-name` returns every stack in the region
 * *with its outputs*, in one paginated call — which is the whole reason this is
 * one function rather than a `list-stacks` plus a `describe-stacks` per
 * environment. An `aws` process costs about a second before it says anything,
 * so asking four times for four environments is four seconds of a page that is
 * meant to settle instantly. Deleted stacks are not returned, so there is
 * nothing to filter out but the other people's stacks in the account.
 */
export interface CloudStack {
  name: string;
  status: string;
  healthy: boolean;
  nested: boolean;
  outputs: Record<string, string>;
}

export async function snapshotPlayStacks(
  ctx: Partial<AwsContext> = {},
): Promise<CloudStack[]> {
  const response = await awsJson<DescribeAllResponse>(["cloudformation", "describe-stacks"], {
    ...ctx,
    optional: true,
  });

  return (response?.Stacks ?? [])
    .filter((stack) => stack.StackName.startsWith("Play"))
    .map((stack) => {
      const outputs: Record<string, string> = {};
      for (const output of stack.Outputs ?? []) outputs[output.OutputKey] = output.OutputValue;
      return {
        // CDK names a nested stack `<parent>-<LogicalId>-<hash>`; the hash is
        // what makes it unreadable, so the console keeps them but labels them.
        name: stack.StackName,
        status: stack.StackStatus,
        healthy: stackHealthy(stack.StackStatus),
        nested: /NestedStack/i.test(stack.StackName),
        outputs,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The four root stacks of a stage, and whether all of them are settled. */
export function summariseStacks(
  stage: string,
  all: CloudStack[],
): { root: StackSummary[]; complete: number; deployed: boolean; partial: boolean } {
  const root = rootStackNames(stage).map((name) => {
    const found = all.find((stack) => stack.name === name);
    return found
      ? { name: found.name, status: found.status, healthy: found.healthy, nested: found.nested }
      : { name, status: "NOT_DEPLOYED", healthy: false, nested: false };
  });
  const complete = root.filter((stack) => stack.healthy).length;
  return {
    root,
    complete,
    deployed: complete === root.length,
    partial: complete > 0 && complete < root.length,
  };
}
