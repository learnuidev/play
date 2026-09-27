'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { describeKey, type PlaygroundCredential } from '@/lib/api-playground';

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

/**
 * What is remembered about a key between reloads.
 *
 * The secret, and just enough about it to draw the card again: its name, the id
 * that revokes it, and the organization it was made for — which is not only a
 * label here, it is what the page fills the organization fields in with and
 * what narrows the pickers to that organization's courses. Nothing else about
 * the key is kept, and nothing about it is kept anywhere but this tab's session.
 */
interface StoredCredential {
  secret: string;
  label: string;
  keyId?: string;
  organizationId?: string;
  organizationName?: string;
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

  /**
   * The secret in play, so that an answer about a key which has since been
   * replaced cannot be written over the key that replaced it.
   */
  const liveSecret = useRef<string | null>(null);

  const useKey = useCallback((next: Extract<PlaygroundCredential, { kind: 'key' }>) => {
    liveSecret.current = next.secret;
    setCredential(next);
    try {
      const stored: StoredCredential = {
        secret: next.secret,
        label: next.label,
        ...(next.keyId ? { keyId: next.keyId } : {}),
        ...(next.organizationId ? { organizationId: next.organizationId } : {}),
        ...(next.organizationName ? { organizationName: next.organizationName } : {}),
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage being unavailable costs a refresh, not the key.
    }
  }, []);

  const forget = useCallback(() => {
    liveSecret.current = null;
    setCredential(null);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do: it was never written.
    }
  }, []);

  // Read after mount rather than during render: `sessionStorage` does not exist
  // on the server, and reading it while rendering would make the first paint
  // disagree with the markup the server sent.
  useEffect(() => {
    let stored: StoredCredential | null = null;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as StoredCredential;
    } catch {
      // A store that cannot be read is a store with nothing in it.
    }

    setReady(true);
    if (!stored?.secret) return;

    const { secret, label, keyId, organizationId, organizationName } = stored;
    useKey({
      kind: 'key',
      secret,
      label,
      ...(keyId ? { keyId } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(organizationName ? { organizationName } : {}),
    });

    /**
     * A stored key that does not say which organization it reaches is asked.
     *
     * A key made on this page carries the organization in its own record, but
     * one made somewhere else — on the keys page, or by an older visit to this
     * one, before the page thought to keep it — arrives with nothing to fill the
     * organization fields in from, and the page cannot be specific about a fact
     * it does not have. `GET /v1/me` is that fact, asked of the key itself,
     * which is what makes a pasted key behave like one made here.
     */
    if (organizationId) return;

    void describeKey(secret).then((description) => {
      if (!description || liveSecret.current !== secret) return;
      useKey({ kind: 'key', secret, label, ...(keyId ? { keyId } : {}), ...description });
    });
  }, [useKey]);

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
