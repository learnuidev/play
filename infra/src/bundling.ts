import fs from 'node:fs';
import path from 'node:path';

import { Code } from 'aws-cdk-lib/aws-lambda';

import { DIST_DIR, SERVICE_DIR } from './paths';

/**
 * Turns a handler entry point into the Lambda code and handler string CDK wants.
 *
 * The two halves come from one string, which is the point: the entry is read
 * from the generated service table (`src/functions/videos/list-videos.ts`), and
 * both the asset directory and the handler are derived from it. Nothing
 * anywhere holds a list mapping a function to a file, so nothing can hold one
 * that disagrees with the source tree.
 *
 * ```
 * src/functions/videos/list-videos.ts
 *   → infra/dist/src/functions/videos/list-videos/index.js   (the asset)
 *   → index.handler                                          (the handler)
 * ```
 *
 * The missing directory is checked for here rather than left to CDK, because
 * CDK's error for a missing asset path is a bare ENOENT naming a path under
 * `dist/` — which reads as a broken CDK install rather than as "you have not
 * run the bundler".
 */
export function bundle(entry: string): { code: Code; handler: string } {
  if (!entry.startsWith('src/')) {
    throw new Error(`Handler entry must be relative to services/api, got '${entry}'`);
  }

  const directory = path.join(DIST_DIR, entry.replace(/\.ts$/, ''));
  const script = path.join(directory, 'index.js');

  if (!fs.existsSync(script)) {
    throw new Error(
      [
        `No bundle for ${entry}: ${path.relative(SERVICE_DIR, script)} is missing.`,
        '',
        'The handlers are bundled once, ahead of synth, rather than per function:',
        '',
        '  npm run bundle --workspace play-infra',
      ].join('\n'),
    );
  }

  return { code: Code.fromAsset(directory), handler: 'index.handler' };
}
