/**
 * Everything this app knows about the Play deployment it talks to.
 *
 * A third-party app has exactly three things to be told: where the API is, where
 * the consent screen is, and what the app was registered as. The first two are
 * deployment facts; the third is a value somebody copied out of the studio once
 * and put in `.env.local`, because a client id is minted by *registering an app*
 * — there is no way to derive it, which is the same reason a real integration
 * has a setup step.
 */

/** Where the API lives. The same variable Play's own apps read, and the same default. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

/**
 * Where the consent screen is served from.
 *
 * The studio, not the API: `/oauth/authorize` is a page in Play's own app, which
 * is the whole design — somebody types their Play password into Play, and never
 * into this app. A deployment would point this at the deployed studio.
 */
export const STUDIO_URL = (
  process.env.NEXT_PUBLIC_PLAY_STUDIO_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '');

/**
 * The client id this app was registered as.
 *
 * Empty until somebody registers it. The app is usable without it — it explains
 * what to do instead of failing — because "you have not done the setup yet" is
 * the first thing everybody who clones this sees.
 */
export const CLIENT_ID = process.env.NEXT_PUBLIC_PLAY_CLIENT_ID ?? '';

/**
 * What this app asks for.
 *
 * Four scopes, and read-only: the person who authorizes it can read their own
 * profile, the published catalog, course outlines and lessons, and can play the
 * video. `lessons:stream` is on the list rather than assumed — it is the one
 * permission a catalog-shaped app does not need, and asking for it is a choice
 * this app makes because it plays lessons.
 *
 * The app must be *registered* for these too: asking for a scope the app is not
 * registered for fails the whole authorization request rather than quietly
 * dropping it, which is what the setup card says to paste into the studio.
 */
export const SCOPES = [
  'profile:read',
  'courses:read',
  'lessons:read',
  'lessons:stream',
] as const;

/** The path Play's callback comes back to. Registered on the app, matched exactly. */
export const CALLBACK_PATH = '/auth/callback';

/**
 * This app's redirect URI.
 *
 * Derived from the browser's own origin rather than configured, exactly as
 * Play's own apps derive theirs — so `localhost:4000` works with no extra
 * configuration, and the same build works at whatever address it is served from.
 * It has to match one of the app's registered URIs *exactly*, down to the port.
 */
export function redirectUri(): string {
  return `${window.location.origin}${CALLBACK_PATH}`;
}

/** Whether the app has been registered — that is, whether `CLIENT_ID` was set. */
export function isConfigured(): boolean {
  return CLIENT_ID.length > 0 && API_BASE_URL.length > 0;
}

/**
 * The page that draws the consent screen, with everything this app is asking for.
 *
 * Built here and opened as a top-level navigation rather than fetched: the person
 * has to *see* it and click, and they have to be able to read the address bar
 * while they do — which is what makes it Play's screen rather than this app's.
 */
export function authorizationUrl(state: string, codeChallenge: string): string {
  const url = new URL(`${STUDIO_URL}/oauth/authorize`);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
