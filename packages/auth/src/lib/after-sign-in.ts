'use client';

/**
 * Where somebody was going before they were asked to sign in.
 *
 * A password sign-in happens on the page it was asked for, so `?next=` survives
 * on its own. Signing in with Google or another provider does not: the browser
 * leaves for the Cognito Hosted UI and comes back to `/auth/callback`, which
 * knows nothing about the course page that sent them there — so somebody who
 * pressed "Sign in to register" on a course would land on the front page and
 * have to find it again.
 *
 * Hence a note kept for the round trip. Session storage rather than a cookie or
 * a query parameter: it is per-tab, it dies with the tab, and it never travels
 * through a third party. It is written when the sign-in page opens and read by
 * the callback — read without clearing, because that page's effects run twice
 * under React's strict mode and the second read has to give the same answer.
 */

const KEY = 'play:after-sign-in';

/**
 * A path on this site, or nothing.
 *
 * Both the `next` parameter and the stored note are written by whoever opens the
 * link, so neither can be trusted as a redirect target: `//evil.example` is a
 * URL, not a path, and a sign-in page that forwards to one is a phishing link
 * wearing this app's name.
 */
export function internalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // A backslash is the other half of the same attack, and the half that a
  // `startsWith('/')` check does not catch: `/\evil.com` starts with a single
  // slash, and the URL parser Next's router feeds it to reads the backslash as
  // a second one — `new URL('/\\evil.com', 'https://app.example/sign-in')` is
  // `https://evil.com/`. So a sign-in page forwarding to it would hand somebody
  // to another origin the moment they finished signing in.
  if (value.includes('\\')) return null;
  return value;
}

/** Notes where to send somebody once they are signed in. */
export function rememberAfterSignIn(path: string): void {
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {
    // A browser that refuses session storage (private mode, blocked storage)
    // still signs people in; they just land on the app's default page.
  }
}

/** Where to send somebody once they are signed in, if anywhere was noted. */
export function readAfterSignIn(): string | null {
  try {
    return internalPath(window.sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Forgets the note, once it has been acted on. */
export function forgetAfterSignIn(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to forget if it could not be written.
  }
}
