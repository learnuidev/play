/**
 * PKCE: the proof a public client gives instead of a secret.
 *
 * This app is a **public client** — it has no client secret, because it runs in
 * a browser and anything shipped to a browser is not a secret. What stands in
 * for one is this: the app invents a random `code_verifier`, sends only its
 * SHA-256 hash (the *challenge*) when it sends somebody to the consent screen,
 * and then proves it is the same app by presenting the verifier when it spends
 * the code.
 *
 * The point is what it closes: the code comes back through a browser, a redirect
 * and (usually) somebody's logs. A code that leaked on the way is useless on its
 * own, because spending it needs the verifier — which never left this tab.
 *
 * Play requires this of *every* client, confidential or not, so this is not a
 * workaround for having no secret: it is the flow.
 */

/** Random bytes as base64url: the alphabet PKCE is defined over, and URL-safe. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A verifier, and the challenge derived from it.
 *
 * 32 random bytes — 43 characters of base64url, which is the minimum RFC 7636
 * allows and comfortably past guessing. `crypto.subtle` rather than a hash
 * library: it is the browser's, it is asynchronous by design, and it is the only
 * one that needs no dependency in a demo.
 */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/**
 * The `state` parameter: what ties the browser that comes back to the request
 * that sent it.
 *
 * Without it, an attacker can hand somebody a callback URL carrying *their* code
 * and have the victim's browser attach it to the victim's session — the login
 * CSRF this parameter exists to prevent. It is checked on the way back, and a
 * mismatch is treated as a failed sign-in rather than being ignored.
 */
export function createState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}
