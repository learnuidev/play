'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PlaygroundCredential } from '@/lib/api-playground';

/**
 * The credential every "Try it" on the page calls with.
 *
 * One key for the whole reference rather than one per endpoint: a reader who
 * pastes a key means it for the page, and a page that asked again at every
 * section would be nine prompts for one fact.
 *
 * Held in `sessionStorage` so a reload does not lose it and closing the tab
 * does. An API key in the browser is a credential in a place that JavaScript can
 * read, and the alternative — `localStorage` — would outlive the tab and sit
 * there in a shared machine's profile forever. "This tab" is the shortest honest
 * lifetime that still survives a refresh.
 */

const STORAGE_KEY = 'play.docs.apiKey';

/** What is remembered about a key between reloads: never anything but the key. */
interface StoredCredential {
  secret: string;
  label: string;
  keyId?: string;
}

interface PlaygroundContextValue {
  credential: PlaygroundCredential | null;
  /** False until the store has been read, so the UI does not flash "no key". */
  ready: boolean;
  useKey: (credential: Extract<PlaygroundCredential, { kind: 'key' }>) => void;
  forget: () => void;
}

const PlaygroundContext = createContext<PlaygroundContextValue | null>(null);

export function PlaygroundProvider({ children }: { children: React.ReactNode }) {
  const [credential, setCredential] = useState<PlaygroundCredential | null>(null);
  const [ready, setReady] = useState(false);

  // Read after mount rather than during render: `sessionStorage` does not exist
  // on the server, and reading it while rendering would make the first paint
  // disagree with the markup the server sent.
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StoredCredential;
        if (parsed?.secret) {
          setCredential({
            kind: 'key',
            secret: parsed.secret,
            label: parsed.label,
            ...(parsed.keyId ? { keyId: parsed.keyId } : {}),
          });
        }
      }
    } catch {
      // A store that cannot be read is a store with nothing in it.
    }
    setReady(true);
  }, []);

  const useKey = useCallback((next: Extract<PlaygroundCredential, { kind: 'key' }>) => {
    setCredential(next);
    try {
      const stored: StoredCredential = {
        secret: next.secret,
        label: next.label,
        ...(next.keyId ? { keyId: next.keyId } : {}),
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage being unavailable costs a refresh, not the key.
    }
  }, []);

  const forget = useCallback(() => {
    setCredential(null);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do: it was never written.
    }
  }, []);

  const value = useMemo<PlaygroundContextValue>(
    () => ({ credential, ready, useKey, forget }),
    [credential, ready, useKey, forget],
  );

  return <PlaygroundContext.Provider value={value}>{children}</PlaygroundContext.Provider>;
}

/** The page's credential, for anything that runs a request. */
export function usePlayground(): PlaygroundContextValue {
  const value = useContext(PlaygroundContext);
  if (!value) {
    throw new Error('usePlayground must be used inside a PlaygroundProvider');
  }
  return value;
}
