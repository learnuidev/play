#!/usr/bin/env node
/**
 * Fetches the backend CloudFormation stack outputs (deployed with Serverless
 * Framework) and writes the required NEXT_PUBLIC_* values to `.env.local`.
 *
 * Usage:
 *   node scripts/get-env.js [options]
 *
 * Options:
 *   --profile=<name>     AWS profile to use          (default: yoserverless)
 *   --stage=<name>       Backend stage               (default: dev)
 *   --stack-name=<name>  Full CloudFormation stack   (default: play-backend-<stage>)
 *   --region=<name>      AWS region                  (default: us-east-1)
 *   --out=<path>         Output file                 (default: ./.env.local)
 *   --help               Show this help
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Usage: node scripts/get-env.js [options]",
      "",
      "Options:",
      "  --profile=<name>     AWS profile to use          (default: yoserverless)",
      "  --stage=<name>       Backend stage               (default: dev)",
      "  --stack-name=<name>  Full CloudFormation stack   (default: play-backend-<stage>)",
      "  --region=<name>      AWS region                  (default: us-east-1)",
      "  --out=<path>         Output file                 (default: ./.env.local)",
      "  --help               Show this help",
    ].join("\n"),
  );
  process.exit(0);
}

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

// Replace this with your own profile
const DEFAULT_AWS_PROFILE = "yoserverless";

const profile = getArg(
  "profile",
  process.env.AWS_PROFILE || DEFAULT_AWS_PROFILE,
);
const stage = getArg("stage", process.env.STAGE || "dev");
const stackName = getArg(
  "stack-name",
  process.env.STACK_NAME || `play-backend-${stage}`,
);
const region = getArg(
  "region",
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
);
const outFile = getArg("out", path.join(__dirname, "..", ".env.local"));

function run(cmd, argv) {
  try {
    return execFileSync(cmd, argv, { encoding: "utf8" });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `Could not find the '${cmd}' executable. Install the AWS CLI (https://aws.amazon.com/cli/) and make sure it is on your PATH.`,
      );
    }
    const stderr = err.stderr ? String(err.stderr) : err.message;
    throw new Error(`Command failed: ${cmd} ${argv.join(" ")}\n${stderr}`);
  }
}

console.log(
  `Fetching stack outputs from '${stackName}' (profile: ${profile}, region: ${region})...`,
);

const raw = run("aws", [
  "cloudformation",
  "describe-stacks",
  "--stack-name",
  stackName,
  "--profile",
  profile,
  "--region",
  region,
  "--output",
  "json",
]);

const parsed = JSON.parse(raw);
const stack = parsed.Stacks && parsed.Stacks[0];
if (!stack) {
  throw new Error(
    `Stack '${stackName}' not found. Is the backend deployed with this stage/profile?`,
  );
}

const outputs = {};
for (const o of stack.Outputs || []) {
  outputs[o.OutputKey] = o.OutputValue;
}

const env = {
  NEXT_PUBLIC_API_URL: outputs.ApiUrl,
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: outputs.CognitoUserPoolId,
  NEXT_PUBLIC_COGNITO_CLIENT_ID: outputs.CognitoUserPoolClientId,
};

const missing = Object.entries(env)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missing.length > 0) {
  throw new Error(
    `Stack '${stackName}' is missing outputs for: ${missing.join(", ")}`,
  );
}

const content = `${Object.entries(env)
  .map(([key, value]) => `${key}=${value}`)
  .join("\n")}\n`;

fs.writeFileSync(outFile, content);
console.log(`\nWrote ${path.resolve(outFile)}:\n`);
console.log(content);
