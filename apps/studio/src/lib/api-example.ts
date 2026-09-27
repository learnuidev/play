import { apiUrl } from './api-base';
import type { ApiEndpoint } from './api-reference';

/**
 * A runnable command for one endpoint, built from the reference itself.
 *
 * Generated rather than written out per endpoint, because a hand-written example
 * is a second copy of the path and one of the two is eventually wrong. The path
 * parameters are filled with the same example values the field tables show, so
 * the command and the documentation above it describe one request.
 *
 * The credential is a shell variable rather than a literal secret: a reference
 * whose examples paste a key into a terminal history, a screenshot or a ticket
 * is teaching the habit that leaks one.
 */
export function curlFor(endpoint: ApiEndpoint): string {
  const args = [`curl "${apiUrl(interpolatedPath(endpoint))}"`];

  args.push(
    endpoint.auth === 'key'
      ? '  -H "x-api-key: $PLAY_API_KEY"'
      : // The key-management endpoints carry the session token the app itself
        // uses, which is why they are documented here and still cannot be called
        // with the key beside them.
        '  -H "Authorization: Bearer $PLAY_TOKEN"',
  );

  if (endpoint.method !== 'GET') args.push(`  -X ${endpoint.method}`);

  if (endpoint.body?.length) {
    args.push('  -H "Content-Type: application/json"');
    args.push(`  --data '${indentAfterFirstLine(JSON.stringify(exampleBody(endpoint), null, 2))}'`);
  }

  return args.join(' \\\n');
}

/**
 * Indents a pretty-printed JSON body so it sits under the `--data` it belongs
 * to. Whitespace inside the quoting is part of the JSON text and immaterial to
 * parsing, which is what makes this free.
 */
function indentAfterFirstLine(json: string): string {
  return json
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');
}

/** The path with its `{placeholders}` replaced by the documented example values. */
export function interpolatedPath(endpoint: ApiEndpoint): string {
  return (endpoint.parameters ?? [])
    .filter((parameter) => parameter.in === 'path')
    .reduce(
      (path, parameter) =>
        path.replace(`{${parameter.name}}`, parameter.example ?? `{${parameter.name}}`),
      endpoint.path,
    );
}

/** The body the example sends: every documented field, at its example value. */
function exampleBody(endpoint: ApiEndpoint): Record<string, string> {
  return Object.fromEntries(
    (endpoint.body ?? [])
      .filter((field) => field.example !== undefined)
      .map((field) => [field.name, field.example as string]),
  );
}
