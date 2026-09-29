#!/usr/bin/env node
/**
 * Fetches the backend CloudFormation stack outputs (the AWS CDK app) and writes
 * the required NEXT_PUBLIC_* values to `.env.local`.
 *
 * Both apps read the same deployment: one user pool, one API, one bucket. They
 * differ only in where they run, and the redirect URLs Cognito needs are derived
 * from the browser's own origin — so this script writes the same file into
 * either app and the only thing that changes is the port the app serves on.
 *
 * ## Two stacks, because the backend is four
 *
 * The CDK app splits the backend by what a change to it costs — the data, the
 * media, the auth and the API are separate stacks (`infra/bin/play.ts`). The
 * values an app needs come from two of them: the API URL from `PlayApiStack`,
 * and the user pool, its client and the Hosted UI domain from `PlayAuthStack`.
 * Both are read and their outputs merged, so a caller still gets one flat map.
 *
 * Usage (from an app's own directory, or through `npm run get-env` at the root):
 *   node ../../scripts/get-env.mjs [options]
 *
 * Options:
 *   --profile=<name>     AWS profile to use          (default: scripts/api-config.env)
 *   --stage=<name>       Backend stage               (default: dev)
 *   --region=<name>      AWS region                  (default: us-east-1)
 *   --out=<path>         Output file                 (default: ./.env.local of the current directory)
 *   --help               Show this help
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Usage: node ../../scripts/get-env.mjs [options]",
      "",
      "Options:",
      "  --profile=<name>     AWS profile to use          (default: scripts/api-config.env)",
      "  --stage=<name>       Backend stage               (default: dev)",
      "  --region=<name>      AWS region                  (default: us-east-1)",
      "  --out=<path>         Output file                 (default: ./.env.local, in the current directory)",
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

// The profile is not written down here: `api-config.env`, beside this script, is
// the one place that names it. It is resolved from the script's own directory
// rather than the working directory, because this runs from inside an app.
const API_CONFIG_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "api-config.env",
);

function readApiConfig() {
  const config = {};
  for (const line of fs.readFileSync(API_CONFIG_FILE, "utf8").split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const separator = text.indexOf("=");
    if (separator === -1) {
      throw new Error(
        `${API_CONFIG_FILE}: expected a KEY=value line, found '${text}'.`,
      );
    }
    config[text.slice(0, separator).trim()] = text
      .slice(separator + 1)
      .trim();
  }
  if (!config.API_AWS_PROFILE) {
    throw new Error(`${API_CONFIG_FILE}: API_AWS_PROFILE is not set.`);
  }
  return config;
}

const profile = getArg(
  "profile",
  process.env.AWS_PROFILE || readApiConfig().API_AWS_PROFILE,
);
const stage = getArg("stage", process.env.STAGE || "dev");
const region = getArg(
  "region",
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
);
const outFile = getArg("out", path.resolve(process.cwd(), ".env.local"));

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

/**
 * The stacks whose outputs an app needs, and what each one is for.
 *
 * Named rather than discovered by prefix: a prefix scan would silently include a
 * stack from another stage if one were ever deployed under a shared account, and
 * the failure would be an app pointed at the wrong API.
 */
const STACKS = [
  [`PlayApiStack-${stage}`, "the API URL"],
  [`PlayAuthStack-${stage}`, "the user pool, its client and the Hosted UI domain"],
];

console.log(`Fetching stack outputs (profile: ${profile}, region: ${region})...`);

const outputs = {};
for (const [stackName, purpose] of STACKS) {
  process.stdout.write(`  ${stackName} — ${purpose}\n`);

  let raw;
  try {
    raw = run("aws", [
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
  } catch (err) {
    throw new Error(
      `Stack '${stackName}' was not found. Deploy the backend with this stage and profile first:\n\n` +
        `  npm run deploy --workspace play-infra\n\n${err.message}`,
    );
  }

  const stack = JSON.parse(raw).Stacks && JSON.parse(raw).Stacks[0];
  if (!stack) {
    throw new Error(`Stack '${stackName}' not found. Is the backend deployed?`);
  }

  for (const o of stack.Outputs || []) {
    outputs[o.OutputKey] = o.OutputValue;
  }
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
    `The backend stacks are missing outputs for: ${missing.join(", ")}. ` +
      "A partially deployed backend is worth looking at before trusting it.",
  );
}

// Optional: present only when the backend was deployed with Google OAuth
// credentials (see services/api/scripts/set-google-oauth.sh). Without them the
// app falls back to email/password sign-in only.
const optionalEnv = {
  NEXT_PUBLIC_COGNITO_DOMAIN: outputs.CognitoDomain,
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: outputs.GoogleAuthEnabled,
};

for (const [key, value] of Object.entries(optionalEnv)) {
  if (value) env[key] = value;
}

if (!optionalEnv.NEXT_PUBLIC_COGNITO_DOMAIN) {
  console.log(
    "\nGoogle sign-in is not configured on this stack — skipping NEXT_PUBLIC_COGNITO_DOMAIN.",
  );
}

// Keys this script does not manage are carried over from the existing file.
//
// Not every value an app needs comes from the stack: the demo's client id is
// minted by registering an OAuth app in the studio, and a script that rewrote
// the file wholesale would delete it every time somebody refreshed their
// environment. Anything already written by hand stays written.
const MANAGED = new Set(Object.keys(env));
const preserved = [];
try {
  for (const line of fs.readFileSync(outFile, "utf8").split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) continue;

    // Comments are kept as they are: a note somebody wrote beside a value is
    // often the reason the value is what it is, and it is the part a generated
    // file cannot reconstruct.
    if (trimmed.trimStart().startsWith("#")) {
      preserved.push(trimmed);
      continue;
    }

    const match = /^\s*([A-Z0-9_]+)\s*=/.exec(trimmed);
    if (!match || MANAGED.has(match[1])) continue;
    preserved.push(trimmed);
    MANAGED.add(match[1]);
  }
} catch {
  // No file yet, or unreadable: there is nothing to preserve.
}

const content = `${[
  ...preserved,
  ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
].join("\n")}\n`;

fs.writeFileSync(outFile, content);
console.log(`\nWrote ${path.resolve(outFile)}:\n`);
console.log(content);
