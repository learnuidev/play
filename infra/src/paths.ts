import fs from 'node:fs';
import path from 'node:path';

/**
 * The directories this app reads and writes, found rather than counted.
 *
 * `__dirname` is `infra/src/` under `ts-node` and `infra/dist/src/` under a built
 * copy, so `../..` is a different place in each. Walking up to `cdk.json` is
 * right in both, and it is also what makes the app runnable from any working
 * directory — `cdk` invokes it from `infra/`, a script may invoke it from
 * anywhere.
 */
function findAbove(start: string, marker: string): string {
  let directory = start;
  for (;;) {
    if (fs.existsSync(path.join(directory, marker))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not find ${marker} above ${start}`);
    }
    directory = parent;
  }
}

/** `infra/` — where `cdk.json`, `config/` and `dist/` live. */
export const INFRA_ROOT = findAbove(__dirname, 'cdk.json');

/** The repository root — where `services/`, `apps/` and `packages/` live. */
export const REPO_ROOT = path.resolve(INFRA_ROOT, '..');

/** `services/api` — the handlers, and the package they belong to. */
export const SERVICE_DIR = path.join(REPO_ROOT, 'services', 'api');

/**
 * Where `scripts/bundle.mjs` writes.
 *
 * One directory per handler, each holding `index.js` and `index.js.map`. The
 * stacks reference these with `Code.fromAsset`, which is why the bundling is a
 * step of its own rather than something `synth` triggers 134 times.
 */
export const DIST_DIR = path.join(INFRA_ROOT, 'dist');

/** `infra/config` — the discovered resource names, one file per stage. */
export const CONFIG_DIR = path.join(INFRA_ROOT, 'config');
