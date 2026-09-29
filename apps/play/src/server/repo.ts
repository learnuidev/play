import fs from "node:fs";
import path from "node:path";

import type { AppKey } from "@/lib/types";

/**
 * Where everything is, found rather than counted.
 *
 * The console is *driven from* `apps/play` but its whole subject is the
 * repository above it: `infra/` for the stacks, `services/api` for the handlers,
 * `scripts/api-config.env` for the profile, and the three apps it starts. Every
 * path here is derived from one root, so the console does not care where Next
 * put its working directory — `next dev` runs with `cwd` set to this app, but a
 * `next start` from somewhere else, or a test, would not.
 */

/**
 * The marker that says "this is the repository root".
 *
 * `infra/src/generated/service.ts` rather than `package.json`: there are
 * `package.json` files all the way down, and the generated service table is the
 * one file that exists here and nowhere else.
 */
const ROOT_MARKER = path.join("infra", "src", "generated", "service.ts");

let cachedRoot: string | null = null;

export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;

  const from = process.env.PLAY_REPO_ROOT
    ? path.resolve(process.env.PLAY_REPO_ROOT)
    : process.cwd();

  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, ROOT_MARKER))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Could not find the Play repository root from '${from}': no ${ROOT_MARKER} above it. ` +
      "Set PLAY_REPO_ROOT if the console is running outside the checkout.",
  );
}

export function repoPath(...parts: string[]): string {
  return path.join(repoRoot(), ...parts);
}

/** The three apps the console starts, in the order they are shown. */
export interface AppDefinition {
  key: AppKey;
  name: string;
  blurb: string;
  port: number;
  /** The workspace package name, so `npm run dev --workspace` could drive it. */
  workspace: string;
}

export const APPS: AppDefinition[] = [
  {
    key: "studio",
    name: "Studio",
    blurb: "Where creators make courses — the authoring app, on port 3000.",
    port: 3000,
    workspace: "play-studio",
  },
  {
    key: "marketplace",
    name: "Marketplace",
    blurb: "Where learners find courses — the public app, on port 3001.",
    port: 3001,
    workspace: "play-marketplace",
  },
  {
    key: "demo",
    name: "Demo",
    blurb:
      "Somebody else's OAuth client of the same API — a leaf, on port 4000.",
    port: 4000,
    workspace: "play-demo",
  },
];

export function appDefinition(key: string): AppDefinition | undefined {
  return APPS.find((app) => app.key === key);
}

export function appDir(key: AppKey): string {
  return repoPath("apps", key);
}

/**
 * The `next` binary, resolved rather than shelled out to.
 *
 * `npx next` would be a second Node process spent deciding what to run, and
 * `npm run dev --workspace play-studio` cannot take a port without editing the
 * script. Next is hoisted to the root `node_modules` by the workspace install,
 * which is exactly where this looks.
 */
export function nextBin(): string {
  const candidates = [
    repoPath("node_modules", "next", "dist", "bin", "next"),
    repoPath("apps", "play", "node_modules", "next", "dist", "bin", "next"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "Could not find the `next` binary. Run `npm install` at the repository root.",
    );
  }
  return found;
}

/** The CDK CLI, from the workspace install — not a global one. */
export function cdkBin(): string {
  const candidates = [
    repoPath("node_modules", ".bin", "cdk"),
    repoPath("infra", "node_modules", ".bin", "cdk"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "Could not find the `cdk` binary. Run `npm install` at the repository root.",
    );
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * The AWS profile
 * ------------------------------------------------------------------ */

export interface ProfileSetting {
  profile: string;
  source: "AWS_PROFILE" | "scripts/api-config.env";
}

/**
 * The profile the repository's scripts reach AWS with.
 *
 * `scripts/api-config.env` is the one place this repository names it, and it is
 * read here for the same reason it is read by `get-env.mjs` and the CDK scripts:
 * a second copy of the name is a second thing to change. An `AWS_PROFILE`
 * already in this process's environment wins, because that is how the file's
 * own documentation says it works — a machine deploying under a different
 * profile needs no edit.
 */
export function profileSetting(): ProfileSetting {
  const fromEnv = process.env.AWS_PROFILE?.trim();
  if (fromEnv) return { profile: fromEnv, source: "AWS_PROFILE" };

  try {
    const text = fs.readFileSync(repoPath("scripts", "api-config.env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      if (trimmed.slice(0, separator).trim() === "API_AWS_PROFILE") {
        const value = trimmed.slice(separator + 1).trim();
        if (value) return { profile: value, source: "scripts/api-config.env" };
      }
    }
  } catch {
    // Falls through to the default: a checkout without the file still has a
    // profile name, and the AWS CLI will say what it does not like.
  }

  return { profile: "default", source: "scripts/api-config.env" };
}

export function defaultRegion(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
}
