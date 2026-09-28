import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { InvalidClientError } from './oauth-apps';
import { HttpError } from './http';

/**
 * The OAuth endpoints' own dialect.
 *
 * Everything else in this service answers with `{ error: { code, message } }`,
 * and the OAuth endpoints must not: RFC 6749 specifies `{"error": "...",
 * "error_description": "..."}`, and the clients that speak this protocol —
 * libraries, SDKs, a provider's own backend — parse the form the specification
 * names. An endpoint that answered in this service's house style would be an
 * endpoint every OAuth library fails on, which is the whole reason this file
 * exists separately from `lib/http`.
 *
 * The description is written for the developer who is integrating, and it is
 * deliberately more talkative than this API is anywhere else: it is not shown to
 * a person, the client is already trusted with its own client id, and an
 * integration that is failing needs to be told why.
 */

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'unsupported_response_type'
  | 'server_error';

export class OAuthError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    description: string,
    /** Almost always 400. `invalid_client` over HTTP Basic is 401. */
    public readonly status = 400,
  ) {
    super(description);
    this.name = 'OAuthError';
  }
}

/**
 * A failed OAuth request, as the specification shapes it.
 *
 * `Cache-Control: no-store` is on every answer here, error or not, and it is not
 * decoration: a token response is a credential, and a proxy that cached one
 * would hand it to the next caller. RFC 6749 requires it of token responses, and
 * applying it to the errors too costs nothing and removes a way to be wrong.
 */
export function oauthResponse(
  body: Record<string, unknown>,
  statusCode = 200,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'OPTIONS, POST',
    },
    body: JSON.stringify(body),
  };
}

/** Wraps a handler so that a refusal is written in the protocol's dialect. */
export function handleOAuth(
  fn: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>,
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof OAuthError) {
        return oauthResponse(
          { error: err.code, error_description: err.message },
          err.status,
        );
      }
      if (err instanceof InvalidClientError) {
        return oauthResponse(
          { error: 'invalid_client', error_description: err.message },
          err.status,
        );
      }
      // A 4xx from the shared helpers — a malformed body, a limit that is not a
      // number — is a bad request, and saying so in the protocol's dialect is
      // what lets a client library act on it.
      if (err instanceof HttpError && err.statusCode < 500) {
        return oauthResponse(
          { error: 'invalid_request', error_description: err.message },
          err.statusCode,
        );
      }
      console.error('Unhandled OAuth error', err);
      return oauthResponse(
        { error: 'server_error', error_description: 'Internal server error' },
        500,
      );
    }
  };
}

/**
 * The request's parameters, whichever way they were sent.
 *
 * RFC 6749 requires `application/x-www-form-urlencoded` on the token endpoint,
 * so that is the form this reads first — but JSON is accepted beside it, because
 * everything else in this API takes JSON and an integrator who sends it is
 * making a reasonable mistake rather than an unreasonable one. Both arrive as a
 * string in the event body, and API Gateway base64-encodes a body it considers
 * binary, which a form-encoded one can be.
 */
export function oauthParams(event: APIGatewayProxyEvent): Record<string, string> {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');

  const trimmed = raw.trim();
  if (!trimmed) return {};

  const contentType = headerOf(event, 'content-type') ?? '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (value === null || value === undefined) continue;
        out[key] = typeof value === 'string' ? value : String(value);
      }
      return out;
    } catch {
      throw new OAuthError('invalid_request', 'The request body is not valid JSON');
    }
  }

  if (contentType.includes('application/json')) {
    throw new OAuthError('invalid_request', 'The request body is not valid JSON');
  }

  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(trimmed)) out[key] = value;
  return out;
}

/** One required parameter, or the protocol's `invalid_request`. */
export function requireParam(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (!value) throw new OAuthError('invalid_request', `${name} is required`);
  return value;
}

/**
 * The client's credentials, from wherever they were presented.
 *
 * Both standard places, because real clients use both and neither is optional in
 * practice: `client_secret_basic` puts them in an `Authorization: Basic` header —
 * which is what most server-side libraries do by default — and
 * `client_secret_post` puts them in the body, which is what most browser and CLI
 * libraries do. A public client presents a `client_id` and nothing else.
 *
 * The Basic form is base64 of `client_id:client_secret` with **both halves
 * percent-encoded**, per RFC 6749 §2.3.1, and the decoding that gets that wrong
 * is the classic reason a client id containing a colon authenticates
 * everywhere except here.
 */
export interface ClientCredentials {
  clientId: string;
  clientSecret?: string;
  /** True when the credentials arrived in the `Authorization` header. */
  viaBasic: boolean;
}

export function readClientCredentials(
  event: APIGatewayProxyEvent,
  params: Record<string, string>,
): ClientCredentials {
  const authorization = headerOf(event, 'authorization');

  if (authorization) {
    const match = /^Basic\s+(.+)$/i.exec(authorization.trim());
    if (!match) {
      throw new OAuthError(
        'invalid_client',
        'The Authorization header must use the Basic scheme on this endpoint',
        401,
      );
    }

    let decoded: string;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      throw new OAuthError('invalid_client', 'The Basic credentials are not valid base64', 401);
    }

    const separator = decoded.indexOf(':');
    if (separator === -1) {
      throw new OAuthError(
        'invalid_client',
        'Basic credentials must be client_id:client_secret',
        401,
      );
    }

    const clientId = formDecode(decoded.slice(0, separator));
    const clientSecret = formDecode(decoded.slice(separator + 1));
    if (!clientId) throw new OAuthError('invalid_client', 'client_id is required', 401);

    return { clientId, ...(clientSecret ? { clientSecret } : {}), viaBasic: true };
  }

  const clientId = params.client_id?.trim();
  if (!clientId) {
    throw new OAuthError('invalid_client', 'client_id is required', 400);
  }
  const clientSecret = params.client_secret?.trim();
  return { clientId, ...(clientSecret ? { clientSecret } : {}), viaBasic: false };
}

/** One header, whatever case it arrived in. */
export function headerOf(event: APIGatewayProxyEvent, name: string): string | undefined {
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === name && value) return value;
  }
  return undefined;
}

/**
 * Percent-decoding one half of a Basic credential.
 *
 * `decodeURIComponent` and not a form decoder, which is a deliberate difference:
 * a form decoder turns `+` into a space, and a client id containing a `+` — which
 * base64url ids deliberately cannot, but somebody else's could — would then
 * authenticate as a different client id than the one on its own row. A value that
 * is not valid percent-encoding is passed through rather than refused: it is
 * about to be looked up and not found, which is the same answer with a better log
 * line.
 */
function formDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
