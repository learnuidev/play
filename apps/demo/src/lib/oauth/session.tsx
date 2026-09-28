'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { beginAuthorization, revokeTokens, type StoredTokens } from './client';
import { isConfigured } from './config';
import { currentAccessToken, getTokens, hydrateOnce, setTokens, subscribe } from './store';

/**
 * The session this app is holding, as the screens see it.
 *
 * `useSyncExternalStore` over the token store rather than a copy in React state:
 * the fetch layer refreshes tokens behind the app's back — that is what makes a
 * request past the hour mark work — and a component holding its own copy would
 * keep rendering the credential that has just been replaced.
 *
 * `ready` distinguishes "nobody is signed in" from "not read yet". The store
 * cannot be read during render without disagreeing with the server's HTML, so
 * the first paint says signed-out and the truth arrives in an effect; without
 * this, every reload would flash "connect your account" at somebody who is
 * connected.
 */

export interface Session {
  tokens: StoredTokens | null;
  ready: boolean;
  signedIn: boolean;
  /** Whether the app has a client id to authorize with at all. */
  configured: boolean;
  /** Sends the browser to Play's consent screen. */
  signIn: (returnTo?: string) => Promise<void>;
  /** Tells Play to revoke the credential, then forgets it here. */
  signOut: () => Promise<void>;
  /** Adopts a pair that came back from the authorization callback. */
  adopt: (tokens: StoredTokens) => void;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const tokens = useSyncExternalStore(subscribe, getTokens, () => null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void hydrateOnce().then(() => setReady(true));
  }, []);

  /**
   * Rotates the access token while the app is open.
   *
   * Half the remaining life, so the new pair arrives long before the old one is
   * refused. The API client also refreshes on demand — the two share one
   * single-use refresh token through the store, which is why they cannot race —
   * and this timer is what keeps a page that is being read, rather than
   * clicked, from being the one that hits the 401.
   */
  useEffect(() => {
    if (!tokens) return;

    const timer = window.setTimeout(
      () => void currentAccessToken(),
      Math.max((tokens.expiresAt - Date.now()) / 2, 30_000),
    );

    return () => window.clearTimeout(timer);
  }, [tokens]);

  const signIn = useCallback(async (returnTo = '/courses') => {
    const url = await beginAuthorization(returnTo);
    // A full navigation rather than a popup: the person has to see Play's own
    // address bar, and a consent screen drawn inside somebody else's frame is a
    // consent screen that anybody could have drawn.
    window.location.assign(url);
  }, []);

  const signOut = useCallback(async () => {
    const current = getTokens();
    // Told before forgotten. Clearing storage alone would leave a working
    // credential at Play and the app still listed on the connections screen.
    if (current) await revokeTokens(current.refreshToken).catch(() => undefined);
    setTokens(null);
  }, []);

  const value = useMemo<Session>(
    () => ({
      tokens,
      ready,
      signedIn: Boolean(tokens),
      configured: isConfigured(),
      signIn,
      signOut,
      adopt: setTokens,
    }),
    [ready, signIn, signOut, tokens],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
