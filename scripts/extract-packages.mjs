#!/usr/bin/env node
/**
 * One-off codemod: lift the studio's shared source into workspace packages.
 *
 * The move is driven by a single table of ownership rules, and the same table
 * decides both *which files move* and *how imports are rewritten* — so the two
 * cannot disagree about where something lives.
 *
 * A moved file keeps its path below `packages/<pkg>/src`, exactly as it sat
 * below `apps/studio/src`. That is what makes the rewrite mechanical: `@/x`
 * becomes `@pkg/x` for whichever package now owns `x`, and nothing else changes.
 *
 * Usage: node scripts/extract-packages.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STUDIO_SRC = path.join(ROOT, 'apps/studio/src');
const DRY_RUN = process.argv.includes('--dry-run');

/** Libraries that belong to the lesson experience rather than to the studio. */
const LEARNING_LIBS = new Set([
  'lib/course',
  'lib/transcript',
  'lib/vtt',
  'lib/timecode',
  'lib/sweep',
  'lib/loop-color',
  'lib/glide',
  'lib/emoji',
  'lib/notes',
]);

/**
 * Where each area of the studio's source ends up, in order of precedence.
 *
 * `alias` is the tsconfig path prefix the package's own files import each other
 * by; `@play/types` is a single-file package and is imported by its bare name.
 */
const RULES = [
  {
    pkg: '@play/types',
    alias: null,
    owns: (p) => p === 'types',
  },
  {
    pkg: '@play/ui',
    alias: '@ui',
    owns: (p) => p === 'lib/utils' || p === 'hooks/use-mobile' || p.startsWith('components/ui/'),
  },
  {
    pkg: '@play/api',
    alias: '@api',
    owns: (p) => p === 'lib/api' || p === 'lib/upload' || p.startsWith('modules/'),
  },
  {
    pkg: '@play/auth',
    alias: '@auth',
    owns: (p) =>
      p === 'lib/amplify' || p === 'components/query-provider' || p === 'hooks/use-viewer',
  },
  {
    pkg: '@play/learning',
    alias: '@learning',
    owns: (p) =>
      p === 'components/video-player' ||
      p === 'components/video/status-badge' ||
      p === 'components/video/video-poster' ||
      p === 'components/space/space-avatar' ||
      p === 'components/space/space-type-badge' ||
      p === 'components/space/space-card' ||
      p.startsWith('components/content/') ||
      p.startsWith('hooks/') ||
      LEARNING_LIBS.has(p),
  },
];

const FILE_RE = /\.(ts|tsx)$/;

/** Strips the extension, so a rule can match `lib/api` for `lib/api.ts`. */
function modulePath(relPath) {
  return relPath.replace(FILE_RE, '');
}

function ownerOf(modulePathValue) {
  for (const rule of RULES) {
    if (rule.owns(modulePathValue)) return rule;
  }
  return null;
}

/** Every `.ts`/`.tsx` file under a directory, as paths relative to it. */
function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (FILE_RE.test(entry.name)) out.push(path.relative(base, full));
  }
  return out;
}

const files = walk(STUDIO_SRC);
const moves = [];
for (const rel of files) {
  const rule = ownerOf(modulePath(rel));
  if (rule) moves.push({ rel, rule });
}

/**
 * Which alias a reference to `@/x` should become, or the reference itself when
 * `x` stays in the app.
 */
function rewriteSpecifier(specifier) {
  if (!specifier.startsWith('@/')) return specifier;
  const target = specifier.slice(2);
  const rule = ownerOf(target);
  if (!rule) return specifier;
  return rule.alias ? `${rule.alias}/${target}` : rule.pkg;
}

const IMPORT_RE = /(\bfrom\s+|\bimport\s+|\brequire\()\s*(['"])(@\/[^'"]+)\2/g;

function rewriteFile(file, { allowAppLocal }) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(IMPORT_RE, (match, lead, quote, specifier) => {
    const next = rewriteSpecifier(specifier);
    return `${lead}${quote}${next}${quote}`;
  });

  if (after === before) return { changed: false, appLocal: [] };

  const appLocal = [];
  for (const m of after.matchAll(/['"](@\/[^'"]+)['"]/g)) {
    if (!allowAppLocal) appLocal.push(m[1]);
  }

  if (!DRY_RUN) fs.writeFileSync(file, after);
  return { changed: true, appLocal };
}

/** Moves every file the rules claim, creating package directories as needed. */
function moveFiles() {
  const report = [];
  for (const { rel, rule } of moves) {
    const dir = rule.pkg.replace('@play/', '');
    const from = path.join('apps/studio/src', rel);
    const to = path.join('packages', dir, 'src', rel);

    if (!DRY_RUN) {
      fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true });
      execFileSync('git', ['mv', from, to], { cwd: ROOT });
    }
    report.push(`${from} -> ${to}`);
  }
  return report;
}

const moved = moveFiles();
console.log(`moved ${moved.length} files`);
for (const line of moved) console.log(`  ${line}`);

// Rewrite imports everywhere: in the packages that just received files, and in
// what the studio keeps, which now points into those packages.
const targets = [
  ...walk(path.join(ROOT, 'packages')).map((rel) => path.join(ROOT, 'packages', rel)),
  ...walk(STUDIO_SRC).map((rel) => path.join(STUDIO_SRC, rel)),
];

let rewritten = 0;
const problems = [];
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const inPackage = file.startsWith(path.join(ROOT, 'packages'));
  const { changed, appLocal } = rewriteFile(file, { allowAppLocal: !inPackage });
  if (changed) rewritten += 1;
  if (inPackage && appLocal.length) {
    problems.push(`${path.relative(ROOT, file)} still imports ${appLocal.join(', ')}`);
  }
}

console.log(`rewrote imports in ${rewritten} files`);
if (problems.length) {
  console.log('\nimports pointing back into the app from a package:');
  for (const p of problems) console.log(`  ${p}`);
}
