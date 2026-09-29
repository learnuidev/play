#!/usr/bin/env node
/**
 * Bundles every handler in `services/api/src/functions` into `infra/dist`.
 *
 * ## Why one pass into a directory, rather than `NodejsFunction`
 *
 * The obvious CDK way is `NodejsFunction`, which runs esbuild for you. Here that
 * would run it **134 times**, once per function, at synth — a synth measured in
 * minutes, and a deploy that re-bundles every function whenever one of them
 * changes. The Serverless service this replaced bundled each function once, into
 * its own artifact, and the CDK app keeps that shape: esbuild runs here, in one
 * pass, and CDK points at the finished directories with `Code.fromAsset`.
 *
 * It is also what keeps a function under Lambda's 250 MB unzipped limit. One
 * artifact for the whole service — which is what `serverless-esbuild` produces
 * by default — put every handler *and every handler's sourcemap* in one zip:
 * 271 MB at 62 functions, of which 159 MB was maps. One directory per function
 * is about 2.4 MB.
 *
 * ## Layout
 *
 * `services/api/src/functions/videos/list-videos.ts` is written to
 * `infra/dist/src/functions/videos/list-videos/index.js`, beside its
 * `index.js.map`. The entry's path is kept whole, so the CDK function's handler
 * is `<entry without .ts>` and its asset directory is the same string — one
 * derivation, and no table anywhere mapping a function to a file.
 *
 * ## Incremental
 *
 * esbuild writes a metafile listing every file that went into each bundle. That
 * list is kept beside the output, and an entry is rebuilt only when one of its
 * inputs is newer than the bundle. A `cdk diff` after editing one handler
 * therefore re-bundles one handler rather than all 134 — and editing anything
 * under `src/lib` rebuilds whatever imported it, because the metafile is the
 * real dependency graph and not a guess about one.
 */

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INFRA = path.resolve(HERE, '..');
const ROOT = path.resolve(INFRA, '..');

const SOURCE_DIR = path.join(ROOT, 'services', 'api', 'src', 'functions');
const OUT_DIR = path.join(INFRA, 'dist');
const STATE_FILE = path.join(OUT_DIR, '.bundle-state.json');

const args = process.argv.slice(2);
const force = args.includes('--force');

/** Every `.ts` under `src/functions`, as paths relative to `services/api`. */
function entryPoints() {
  const entries = {};

  const walk = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) {
        walk(absolute);
      } else if (item.isFile() && item.name.endsWith('.ts') && !item.name.endsWith('.d.ts')) {
        const relative = path.relative(path.join(ROOT, 'services', 'api'), absolute);
        // `src/functions/videos/list-videos.ts` → `src/functions/videos/list-videos/index`
        entries[relative.replace(/\.ts$/, '/index')] = absolute;
      }
    }
  };

  walk(SOURCE_DIR);
  return entries;
}

const entries = entryPoints();
const names = Object.keys(entries).sort();

if (names.length === 0) {
  console.error(`No handlers found under ${path.relative(ROOT, SOURCE_DIR)}.`);
  process.exit(1);
}

const previous = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : {};

const mtime = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** Entries whose bundle is missing, or older than something that went into it. */
const stale = names.filter((name) => {
  if (force) return true;
  const output = path.join(OUT_DIR, `${name}.js`);
  const outputTime = mtime(output);
  if (outputTime === 0) return true;

  const inputs = previous[name];
  // No recorded inputs: the bundle was made before this script kept a metafile,
  // or by something else. Rebuild rather than trust it.
  if (!Array.isArray(inputs)) return true;

  return inputs.some((input) => mtime(path.join(ROOT, input)) > outputTime);
});

if (stale.length === 0) {
  console.log(`${names.length} handlers already bundled in ${path.relative(ROOT, OUT_DIR)}`);
  process.exit(0);
}

console.log(
  `Bundling ${stale.length} of ${names.length} handlers ` +
    `(${names.length - stale.length} up to date)...`,
);

const staleSet = new Set(stale);
const result = await build({
  entryPoints: Object.fromEntries(
    Object.entries(entries).filter(([name]) => staleSet.has(name)),
  ),
  outdir: OUT_DIR,
  // Pinned so every path in the metafile — and therefore every path in the
  // state file — is relative to the repository root, whatever directory this
  // was run from. The staleness check below depends on that.
  absWorkingDir: ROOT,
  bundle: true,
  // Kept off deliberately: a stack trace in CloudWatch is read by a person, and
  // the sourcemaps this keeps are what make it nameable. The size is per
  // function, so it is 2.4 MB rather than 250.
  minify: false,
  sourcemap: true,
  // Matches the runtime the functions are deployed on (`nodejs22.x`).
  target: 'node22',
  platform: 'node',
  format: 'cjs',
  // Nothing is external. The AWS SDK v3 is bundled, which is why the handlers
  // need no `node_modules` beside them and why each artifact is self-contained.
  metafile: true,
  logLevel: 'error',
});

// Merge this run's inputs into the state, leaving the entries that were skipped
// — and therefore were not in the metafile — exactly as they were. The inputs
// are esbuild's own answer to "what went into this bundle", so editing anything
// under `src/lib` marks exactly the handlers that imported it, and nothing has
// to guess that relationship.
const state = { ...previous };
for (const name of stale) {
  const outputKey = path.relative(ROOT, path.join(OUT_DIR, `${name}.js`));
  const meta = result.metafile.outputs[outputKey];
  if (meta) state[name] = Object.keys(meta.inputs).sort();
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

console.log(`Bundled ${stale.length} handlers into ${path.relative(ROOT, OUT_DIR)}`);
