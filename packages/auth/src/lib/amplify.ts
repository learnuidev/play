// Registers the OAuth listener so that a redirect back from the Cognito Hosted
// UI (e.g. Google) completes the sign-in. Must be imported on every page that
// can be a redirect target — importing it here (via `providers.tsx`) covers the
// whole app. Safe on the server: the module no-ops outside the browser.
import 'aws-amplify/auth/enable-oauth-listener';

import { Amplify } from 'aws-amplify';

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
const oauthDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;

/**
 * Where this app is running.
 *
 * Read from the browser rather than fixed, because there are two apps now: the
 * studio serves on 3000 and the marketplace on 3001, both against the same user
 * pool, and a hardcoded origin would send the marketplace's sign-in round trip
 * back to the studio. The backend registers both origins as callback URLs.
 *
 * The fallback is what a server render has instead of a location, and it is only
 * ever used for the URLs Amplify is configured with before the page is alive —
 * sign-in itself always happens in the browser.
 */
const APP_ORIGIN =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:3000';

/** Path the backend registers as a Cognito callback URL. */
export const oauthCallbackPath = '/auth/callback';

/**
 * Cognito only accepts redirect URLs it knows about, so these defaults mirror
 * the backend's `custom.auth.callbackUrls` / `logoutUrls` defaults. Comma-separate
 * to support several origins (e.g. localhost + a deployed domain).
 */
function parseUrlList(value: string | undefined, fallback: string): string[] {
  const urls = (value ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  return urls.length > 0 ? urls : [fallback];
}

export const isAuthConfigured = Boolean(userPoolId && userPoolClientId);

/** True when the Cognito Hosted UI domain is configured (enables OAuth sign-in). */
export const isOAuthConfigured = isAuthConfigured && Boolean(oauthDomain);

/** True when the backend reports that a Google identity provider exists. */
export const isGoogleSignInEnabled =
  isOAuthConfigured && process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';

const oauthRedirectSignIn = parseUrlList(
  process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN,
  `${APP_ORIGIN}${oauthCallbackPath}`,
);
const oauthRedirectSignOut = parseUrlList(
  process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT,
  APP_ORIGIN,
);

if (isAuthConfigured) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: userPoolId!,
        userPoolClientId: userPoolClientId!,
        ...(isOAuthConfigured && {
          loginWith: {
            oauth: {
              domain: oauthDomain!,
              scopes: ['email', 'openid', 'profile'],
              redirectSignIn: oauthRedirectSignIn,
              redirectSignOut: oauthRedirectSignOut,
              responseType: 'code',
            },
          },
        }),
      },
    },
  });
}
