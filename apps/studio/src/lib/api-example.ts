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

  if (endpoint.auth === 'key') {
    args.push('  -H "x-api-key: $PLAY_API_KEY"');
  } else if (endpoint.auth === 'session') {
    // The credential-management endpoints carry the session token the app itself
    // uses, which is why they are documented here and still cannot be called
    // with the key beside them.
    args.push('  -H "Authorization: Bearer $PLAY_TOKEN"');
  } else if (endpoint.auth === 'oauth-client') {
    // A client authenticates *itself* here, with the two values the studio gave
    // it, and there is no third credential involved.
    args.push('  -d "client_id=$PLAY_CLIENT_ID"');
    args.push('  -d "client_secret=$PLAY_CLIENT_SECRET"');
  }

  if (endpoint.method !== 'GET') args.push(`  -X ${endpoint.method}`);

  if (endpoint.body?.length && endpoint.bodyEncoding === 'form') {
    // RFC 6749's `application/x-www-form-urlencoded`, which is what every OAuth
    // client library sends and what an example in JSON would misrepresent.
    for (const field of endpoint.body) {
      if (field.example === undefined) continue;
      args.push(`  -d ${shellQuote(`${field.name}=${field.example}`)}`);
    }
  } else if (endpoint.body?.length) {
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

/**
 * One shell word, quoted when it has to be.
 *
 * A form-encoded example carries characters a shell would eat — `&`, `?`, `:` —
 * and an example that has to be edited before it runs is not an example. Quotes
 * are only added when the value is not a plain word, so the output stays as
 * readable as the JSON bodies beside it.
 */
function shellQuote(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? `"${word}"` : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The authorization URL a client opens, as a URL rather than a command.
 *
 * The one entry in the reference that is not an API call — it is the studio's
 * consent page, which a *browser* is sent to — so its example is the address
 * itself, wrapped the way a client would wrap it, and not a cURL of a page that
 * would answer with HTML.
 */
export function authorizeUrlFor(endpoint: ApiEndpoint): string {
  const path = interpolatedPath(endpoint).replace('{studio}', STUDIO_ORIGIN_PLACEHOLDER);
  const lines = (endpoint.parameters ?? [])
    .filter((parameter) => parameter.in === 'query' && parameter.example !== undefined)
    .map((parameter, index) => {
      const separator = index === 0 ? '?' : '&';
      return `${separator}${parameter.name}=${parameter.example}`;
    });

  const [first, ...rest] = lines;
  return [path + (first ?? ''), ...rest.map((line) => `  ${line}`)].join('\\\n');
}

/** The studio's origin, for the one example that is not an API path. */
const STUDIO_ORIGIN_PLACEHOLDER = 'https://<your-studio>';

/** The path with its `{placeholders}` filled in. */
export function interpolatedPath(
  endpoint: ApiEndpoint,
  /**
   * Values to use, by parameter name. Anything absent falls back to the
   * documented example, which is what the reference prints beside the field and
   * therefore what a reader expects to see in the command above it.
   */
  values: Record<string, string> = {},
): string {
  return (endpoint.parameters ?? [])
    .filter((parameter) => parameter.in === 'path')
    .reduce((path, parameter) => {
      const value = values[parameter.name] ?? parameter.example ?? `{${parameter.name}}`;
      return path.replace(`{${parameter.name}}`, encodeURIComponent(value));
    }, endpoint.path);
}

/** The body the example sends: every documented field, at its example value. */
function exampleBody(endpoint: ApiEndpoint): Record<string, string> {
  return Object.fromEntries(
    (endpoint.body ?? [])
      .filter((field) => field.example !== undefined)
      .map((field) => [field.name, field.example as string]),
  );
}
