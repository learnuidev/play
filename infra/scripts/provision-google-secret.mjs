#!/usr/bin/env node
/**
 * Mirrors the Google OAuth client secret out of SSM and into Secrets Manager.
 *
 * ## Why this exists
 *
 * `AWS::Cognito::UserPoolIdentityProvider` **cannot take an SSM Secure string**.
 * The property is `ProviderDetails.client_secret`, and CloudFormation refuses
 * the reference outright:
 *
 * > SSM Secure reference is not supported in:
 * > [AWS::Cognito::UserPoolIdentityProvider/Properties/ProviderDetails/client_secret]
 *
 * `{{resolve:ssm-secure:...}}` is rejected in `AWS::SecretsManager::Secret`'s
 * `SecretString` as well, so the value cannot be moved across declaratively
 * either — something has to put it there, and that something is this script.
 * A `secretsmanager` dynamic reference *is* accepted in that property, which is
 * the whole reason the value is copied rather than read in place.
 *
 * This only matters when a stack **creates** the user pool. An imported pool
 * already has its Google provider attached — attached by hand, years ago — and
 * no deploy touches it, so `dev` never needs this script to have been run.
 *
 * ## What it does
 *
 * Reads `/play/auth/google-client-secret` as a SecureString, then creates or
 * updates a Secrets Manager secret with the same value. Idempotent: run it
 * twice and the second run writes the same bytes.
 *
 * The SSM parameter stays the source of truth — `set-google-oauth.sh` is what
 * writes it — and this copy is derived from it, so rotate the parameter and
 * re-run this to propagate.
 *
 * ## Usage
 *
 *   node infra/scripts/provision-google-secret.mjs [options]
 *
 *   --profile=<name>     AWS profile to use     (default: $AWS_PROFILE, else default)
 *   --region=<name>      AWS region             (default: $AWS_REGION, else us-east-1)
 *   --ssm-param=<name>   Source parameter       (default: /play/auth/google-client-secret)
 *   --secret-name=<name> Destination secret     (default: play/auth/google-client-secret)
 *   --plan               Report what would change, write nothing
 *   --help               This text
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

if (args.includes('--help') || args.includes('-h')) {
  const lines = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('\n');
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
const ssmParam = value('ssm-param', '/play/auth/google-client-secret');
const secretName = value('secret-name', 'play/auth/google-client-secret');
const plan = args.includes('--plan');

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

console.log(`SSM parameter:    ${ssmParam}`);
console.log(`Secrets Manager:  ${secretName}`);
console.log(`Region:           ${region}${profile ? ` (profile: ${profile})` : ''}\n`);

// The value itself is never printed — not its length beyond a hint, and never a
// prefix. It is a credential, and a terminal is a log.
const withValue = aws(['ssm', 'get-parameter', '--name', ssmParam, '--with-decryption', '--query', 'Parameter.Value', '--output', 'text'], {
  allowMissing: ['ParameterNotFound'],
});

if (!withValue) {
  console.error(
    `No SSM parameter '${ssmParam}'. It is what set-google-oauth.sh writes:\n\n` +
      '  services/api/scripts/set-google-oauth.sh\n\n' +
      'Without it there is nothing to copy, and a new environment cannot attach a\n' +
      'Google identity provider to its pool.',
  );
  process.exit(1);
}

const existing = aws(['secretsmanager', 'describe-secret', '--secret-id', secretName, '--query', 'ARN', '--output', 'text'], {
  allowMissing: ['ResourceNotFoundException'],
});

if (existing) {
  console.log(`Secret exists:    ${existing}`);
  if (plan) {
    console.log('\n--plan: would put the parameter value into that secret. Nothing written.');
    process.exit(0);
  }
  aws(['secretsmanager', 'put-secret-value', '--secret-id', secretName, '--secret-string', withValue]);
  console.log('\nUpdated. A deploy from here can read it as {{resolve:secretsmanager:...}}.');
  process.exit(0);
}

console.log('Secret exists:    no');
if (plan) {
  console.log('\n--plan: would create it with the parameter value. Nothing written.');
  process.exit(0);
}

const arn = aws([
  'secretsmanager', 'create-secret',
  '--name', secretName,
  '--description', 'Google OAuth client secret, mirrored from ' + ssmParam,
  '--secret-string', withValue,
  '--query', 'ARN', '--output', 'text',
]);

console.log(`\nCreated:          ${arn}`);
console.log('A deploy from here can read it as {{resolve:secretsmanager:...}}.');
