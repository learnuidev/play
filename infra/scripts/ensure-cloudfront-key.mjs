#!/usr/bin/env node
/**
 * Ensures the CloudFront URL-signing key pair exists in SSM — generating it if
 * it does not, and never touching it if it does.
 *
 * ## Why a key pair, and why SSM
 *
 * Every video the app plays is served through CloudFront with a signed URL: the
 * distribution's behaviours are gated by a key group, so an unsigned request is
 * a 403 and a signed one expires. That needs a key pair, and the two halves live
 * in two different places on purpose:
 *
 * - the **public** half is read at deploy time by `PlayMediaStack`, which creates
 *   a `AWS::CloudFront::PublicKey` from the parameter's value — so it has to be
 *   in SSM *before* the media stack deploys;
 * - the **private** half is read at request time by the handlers, by parameter
 *   *name* (`CLOUDFRONT_PRIVATE_KEY_PARAM`), which is what keeps a 1.7 KB
 *   credential out of a hundred Lambdas' environments and out of the repository.
 *
 * The two parameter names come from `infra/config/play-<stage>.json`
 * (`cloudFrontPrivateKeyParam`, `cloudFrontPublicKeyParam`) and default to
 * `/play/<stage>/cloudfront/private-key` and `.../public-key`: **one pair per
 * environment**, because the pair signs one distribution's URLs and one
 * environment's handlers should not be able to mint URLs for another's.
 *
 * The exception is a *migrated* stage, and it says so in its own config: `dev`
 * imports the distribution the legacy key group already gates, so its private
 * half is the shared `/play/cloudfront/private-key` — the pair that distribution
 * was created against. This script reads whatever the config names; the names
 * are the decision, not this file.
 *
 * ## Idempotent, in both directions
 *
 * The console calls this when a new environment is created, and the deploy plan
 * calls it as a step, so it is run far more often than it has work to do:
 *
 * | private | public | what happens |
 * | --- | --- | --- |
 * | there | there | nothing. It says so. **It never rotates a key** |
 * | missing | there | nothing, and it exits non-zero: a new private key would not match the public one, and every signed URL the existing distribution hands out would stop working. Somebody has to find the private half, or the parameter name that holds it |
 * | there | missing | the public half is *derived* from the private one and written. Still nothing that invalidates a signature |
 * | missing | missing | a 2048-bit RSA pair is generated and both halves are written |
 *
 * Rotation is deliberately not an option here. CloudFront keeps signing with the
 * public key a distribution was created against, so a new key pair is a
 * **deploy** (a new `PublicKey` and key group), not a script — and the window
 * between writing the parameter and deploying would break playback. This script
 * is the boring half: it makes the absence of a key impossible, and it cannot
 * make a working one stop working.
 *
 * ## Usage
 *
 *   node infra/scripts/ensure-cloudfront-key.mjs --stage=<name> [options]
 *
 *   --stage=<name>       Environment whose config names the parameters (required)
 *   --profile=<name>     AWS profile to use      (default: $AWS_PROFILE, else default)
 *   --region=<name>      AWS region              (default: $AWS_REGION, else us-east-1)
 *   --private-param=<n>  Override the private parameter name
 *   --public-param=<n>   Override the public parameter name
 *   --plan               Report what would change, write nothing
 *   --help               This text
 *
 * The private key's value is never printed, never passed as a command-line
 * argument, and never written inside the repository: it goes through a 0600 file
 * in the OS temporary directory, which is removed before the script exits.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

if (args.includes('--help') || args.includes('-h')) {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  let started = false;
  for (const line of lines.slice(1)) {
    if (!started) {
      if (!line.trimStart().startsWith('/**')) continue;
      started = true;
      continue;
    }
    if (line.trimStart().startsWith('*/')) break;
    console.log(line.replace(/^\s*\*\s?/, ''));
  }
  process.exit(0);
}

const profile = value('profile', process.env.AWS_PROFILE ?? '');
const region = value('region', process.env.AWS_REGION ?? 'us-east-1');
const stage = value('stage', '');
const plan = args.includes('--plan');

if (!stage) {
  console.error(
    'Which environment? Pass --stage=<name>.\n\n' +
      '  node infra/scripts/ensure-cloudfront-key.mjs --stage=staging\n\n' +
      'The parameter names are read from infra/config/play-<stage>.json.',
  );
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configPath = path.join(repoRoot, 'infra', 'config', `play-${stage}.json`);

// Mirrors `infra/src/config.ts`: one pair per environment, derived from the
// stage, so a stage nobody has written a config for yet still has a name.
const defaultPrivateParam = `/play/${stage}/cloudfront/private-key`;
const defaultPublicParam = `/play/${stage}/cloudfront/public-key`;

/** The two names, and where each one came from — which is worth printing. */
function params() {
  let config = null;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    config = null;
  }
  const from = (field, override, fallback) => {
    if (override) return { name: override, source: '--flag' };
    if (config?.[field]) return { name: config[field], source: `play-${stage}.json` };
    return { name: fallback, source: `default for ${stage}` };
  };
  return {
    config,
    privateParam: from('cloudFrontPrivateKeyParam', value('private-param', ''), defaultPrivateParam),
    publicParam: from('cloudFrontPublicKeyParam', value('public-param', ''), defaultPublicParam),
  };
}

const { config, privateParam, publicParam } = params();

const base = ['--region', region, ...(profile ? ['--profile', profile] : [])];

/** Run an aws command, returning stdout, and treating "not found" as null. */
function aws(argv, { allowMissing = [] } = {}) {
  try {
    return execFileSync('aws', [...argv, ...base], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? '');
    if (allowMissing.some((needle) => stderr.includes(needle))) return null;
    throw new Error(`aws ${argv.slice(0, 3).join(' ')} failed:\n${stderr.trim() || error.message}`);
  }
}

/**
 * Which of the two names exist, in one call.
 *
 * `get-parameters` answers for a list of names and puts the ones it could not
 * find in `InvalidParameters` rather than failing the call — so absence is a
 * field in the answer, not an error to interpret. It is also the only SSM read
 * that does not need `--with-decryption` to be sure a SecureString is there.
 */
function present(names) {
  const json = aws([
    'ssm', 'get-parameters',
    '--names', ...names,
    '--query', '{found: Parameters[].Name, missing: InvalidParameters}',
    '--output', 'json',
  ]);
  const answer = json ? JSON.parse(json) : {};
  return new Set(answer.found ?? []);
}

/**
 * `put-parameter` with the value in a file rather than in `argv`.
 *
 * A private key in a process's argument list is a private key in `ps`, and this
 * one is 1.7 KB of credential. `--cli-input-json` is the documented way to hand
 * the CLI a value too big or too sensitive for a shell argument, and the file is
 * deleted before this process exits — success or failure.
 */
function putParameter({ name, type, description, secret }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'play-cloudfront-key-'));
  const file = path.join(directory, 'put-parameter.json');
  try {
    writeFileSync(
      file,
      JSON.stringify({ Name: name, Type: type, Value: secret, Description: description }),
      { mode: 0o600 },
    );
    chmodSync(file, 0o600);
    aws(['ssm', 'put-parameter', '--cli-input-json', `file://${file}`]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function fingerprint(pem) {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

console.log(`Environment:      ${stage}`);
console.log(`Private key:      ${privateParam.name}  (${privateParam.source})`);
console.log(`Public key:       ${publicParam.name}  (${publicParam.source})`);
console.log(`Region:           ${region}${profile ? ` (profile: ${profile})` : ''}`);

if (config && config.ownership && config.ownership.media === false) {
  console.log(
    '\nNOTE: this stage imports its media, so its distribution was created against a key\n' +
      'pair that already exists. Whatever is at the parameter above has to be *that* pair —\n' +
      'generating a new one would make every signed URL the distribution hands out invalid.',
  );
}

const found = present([privateParam.name, publicParam.name]);
const privateFound = found.has(privateParam.name);
const publicFound = found.has(publicParam.name);

console.log(`\nPrivate half:     ${privateFound ? 'present' : 'not in SSM'}`);
console.log(`Public half:      ${publicFound ? 'present' : 'not in SSM'}`);

if (privateFound && publicFound) {
  console.log('\nNothing to do: both halves are in SSM. A key that exists is never rotated —\n' +
    'the distribution signs with the public half it was created against.');
  process.exit(0);
}

if (!privateFound && publicFound) {
  console.error(
    `\nRefusing: ${publicParam.name} exists but ${privateParam.name} does not, so generating a\n` +
      'private key here would produce a pair that does not match the public one. Every signed\n' +
      'URL the distribution hands out would stop working.\n\n' +
      'Either the private half is in a parameter with another name — then set\n' +
      'cloudFrontPrivateKeyParam in ' +
      `infra/config/play-${stage}.json to it — or the key pair has to be\n` +
      'replaced, and that is a deploy of a new CloudFront public key, not this script.',
  );
  process.exit(1);
}

if (plan) {
  console.log(
    privateFound
      ? `\n--plan: would derive the public half from ${privateParam.name} and write ${publicParam.name}. Nothing written.`
      : `\n--plan: would generate a 2048-bit RSA key pair and write both parameters. Nothing written.`,
  );
  process.exit(0);
}

if (privateFound) {
  // The private half is the one thing that cannot be re-derived, so it is read
  // and the public half is computed from it. No new key material.
  const pem = aws([
    'ssm', 'get-parameter', '--name', privateParam.name, '--with-decryption',
    '--query', 'Parameter.Value', '--output', 'text',
  ]);
  if (!pem) {
    console.error(`\n${privateParam.name} could not be read. Nothing written.`);
    process.exit(1);
  }
  const publicPem = createPublicKey(pem).export({ type: 'spki', format: 'pem' });

  putParameter({
    name: publicParam.name,
    type: 'String',
    description: `CloudFront URL-signing public key for the Play videos distribution (public half of ${privateParam.name})`,
    secret: publicPem,
  });

  console.log(`\nWrote ${publicParam.name}, derived from the private half that was already there.`);
  console.log(`Public key fingerprint: sha256:${fingerprint(publicPem).slice(0, 32)}…`);
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

putParameter({
  name: privateParam.name,
  type: 'SecureString',
  description: `CloudFront URL-signing private key for the Play videos distribution (stage ${stage})`,
  secret: privateKey,
});

putParameter({
  name: publicParam.name,
  type: 'String',
  description: `CloudFront URL-signing public key for the Play videos distribution (public half of ${privateParam.name})`,
  secret: publicKey,
});

console.log('\nGenerated a 2048-bit RSA key pair and wrote both halves:');
console.log(`  ${privateParam.name}  SecureString — the handlers sign with it, by name`);
console.log(`  ${publicParam.name}  String — the media stack creates a CloudFront public key from it`);
console.log(`Public key fingerprint: sha256:${fingerprint(publicKey).slice(0, 32)}…`);
console.log('\nA deploy can now create a distribution gated by this key group.');
