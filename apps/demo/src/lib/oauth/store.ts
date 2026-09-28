import { refreshTokens, type StoredTokens } from './client';

/**
 * The tokens, in one place, for two very different readers.
 *
 * React needs them to draw the screen, and the API client needs them to make
 * requests — and those are not the same shape of need. Making React the owner
 * would mean every fetch passing through a hook, and making the fetch layer the
 * owner would mean the screen never re-rendering when a token rotates. This is
 * the small store that both read: the provider subscribes to it, the fetch
 * wrapper calls it, and neither has a second copy to keep in step.
 *
 * It is module state, deliberately, and it is safe here for one reason: there is
 * exactly one of it. A store like this in a component would be shared across
 * everybody's session; a store like this in an app that is *itself* the session
 * is just where the session lives.
 */

const STORAGE_KEY = 'play-demo:tokens';

let tokens: StoredTokens | null = null;
const listeners = new Set<() => void>();

/**
 * Reads what a previous visit left behind.
 *
 * Called from an effect rather than at module load, so that the server-rendered
 * HTML and the first client render agree: both say "nobody is signed in", and
 * the session appears a moment later rather than during hydration — which is
 * what a hydration mismatch would be made of.
 */
export function hydrate(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredTokens) : null;
    if (parsed?.accessToken && parsed?.refreshToken) {
      setTokens(parsed);
      return;
    }
  } catch {
    // Storage can be refused (private mode, blocked cookies), or hold something
    // that is not a session. Either way the answer is the same: nobody is signed
    // in, and signing in again will work for as long as the page is open.
  }
  setTokens(null);
}

export function getTokens(): StoredTokens | null {
  return tokens;
}

/**
 * Hydration, once, with everybody who needs it waiting on the same promise.
 *
 * The API client asks for this before its first request, so the first request
 * carries the token a previous visit left behind rather than going out bare and
 * coming back 401. It runs at most once, deliberately: a second read of storage
 * after a refresh had replaced the tokens would put the *old* pair back.
 */
let hydration: Promise<void> | null = null;

export function hydrateOnce(): Promise<void> {
  hydration ??= Promise.resolve().then(hydrate);
  return hydration;
}

/** Where the tokens are, written through to storage so a reload keeps them. */
export function setTokens(next: StoredTokens | null): void {
  tokens = next;
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A session that lasts until the page is reloaded is a smaller thing than a
    // page that cannot be used at all.
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * In-flight refresh, so two callers never spend the same refresh token.
 *
 * This matters more than it looks: a refresh token is single-use and rotates, so
 * two refreshes racing each other means one of them spends a token the other is
 * about to hand back — and the loser loses the connection. Everything that wants
 * a fresh token waits on the same promise.
 */
let refreshing: Promise<StoredTokens | null> | null = null;

/**
 * A token to authenticate a request with, refreshed first if it is nearly done.
 *
 * Returns nothing when there is no session, or when the refresh was refused —
 * which is what a revoked connection looks like from here, and the app's answer
 * to both is the same: ask the person to sign in again.
 */
export async function currentAccessToken(): Promise<string | null> {
  // Before the first request of a page load, and only then: after that the store
  // is authoritative and this resolves immediately.
  await hydrateOnce();

  const current = tokens;
  if (!current) return null;

  // A minute of slack: a token that expires during a round trip is a request
  // that fails with a 401 the client then has to do over.
  if (current.expiresAt - Date.now() > 60_000) return current.accessToken;

  refreshing ??= refreshTokens(current.refreshToken)
    .then((next) => {
      setTokens(next);
      return next;
    })
    .catch(() => {
      setTokens(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });

  const next = await refreshing;
  return next?.accessToken ?? null;
}
