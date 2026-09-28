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
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(
  /\/+$/,
  "",
);

/**
 * Where the consent screen is served from.
 *
 * The studio, not the API: `/oauth/authorize` is a page in Play's own app, which
 * is the whole design — somebody types their Play password into Play, and never
 * into this app. A deployment would point this at the deployed studio.
 */
export const STUDIO_URL = (
  process.env.NEXT_PUBLIC_PLAY_STUDIO_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

/**
 * The client id this app was registered as.
 *
 * Empty until somebody registers it. The app is usable without it — it explains
 * what to do instead of failing — because "you have not done the setup yet" is
 * the first thing everybody who clones this sees.
 */
export const CLIENT_ID = process.env.NEXT_PUBLIC_PLAY_CLIENT_ID ?? "";

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
  "profile:read",
  "courses:read",
  "lessons:read",
  "lessons:stream",
] as const;

/**
 * The path Play's callback comes back to.
 *
 * Namespaced under `/auth/` so it cannot collide with a route this app grows of
 * its own — and **configurable**, because a redirect URI is a fact about a
 * *deployment* rather than about the code. Play matches it exactly: not a
 * prefix, not a wildcard, and not after any tidying up. Whatever is registered
 * in the studio is the only thing that will work, so the two have to be able to
 * agree without editing a source file.
 */
export const CALLBACK_PATH =
  process.env.NEXT_PUBLIC_PLAY_REDIRECT_PATH ?? "/auth/play/callback";

/**
 * This app's redirect URI.
 *
 * Derived from the browser's own origin rather than configured, exactly as
 * Play's own apps derive theirs — so `localhost:4000` works with no extra
 * configuration, and the same build works at whatever address it is served from.
 * It has to match one of the app's registered URIs *exactly*, down to the port.
 */
export function redirectUri(): string {
  // A whole URI wins when one is configured — for a deployment served at an
  // address the browser cannot derive, or a registration that has to be pinned.
  // It has to name the origin the app is *browsed* at: the verifier that spends
  // the code lives in that origin's session storage, so a callback landing on
  // another host arrives without the one thing that can redeem it.
  const configured = process.env.NEXT_PUBLIC_PLAY_REDIRECT_URI;
  if (configured) return configured;

  return `${window.location.origin}${CALLBACK_PATH}`;
}

/**
 * The client secret, for the deployments that insist on one.
 *
 * **This app should not have one, and the empty default is the point.** It is a
 * browser app: a secret in a bundle is readable by anybody who opens dev tools,
 * so it proves nothing and pretending otherwise is worse than having none. PKCE
 * is what actually protects the flow, and Play requires it of confidential
 * clients too.
 *
 * The variable exists because registering an app as a *public* client is a
 * deliberate choice on a form, and somebody who missed it ends up with a
 * confidential app and a secret. Rather than making them find the checkbox, this
 * app accepts the secret, sends it the way a confidential client does — and says
 * loudly, on the front page, that it should not have one. An honest mistake shown
 * honestly is a better demonstration of the design than a failure to load.
 *
 * Whether a client can keep a secret cannot be changed after registration, so
 * the fix is a new app registered as a public one.
 */
export const CLIENT_SECRET = process.env.PLAY_CLIENT_SECRET ?? "";

/** Whether this build is holding a secret it should not have. */
export function isConfidential(): boolean {
  return CLIENT_SECRET.length > 0;
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
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
