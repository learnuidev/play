'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * One read, as a screen needs it: the answer, the failure, and whether it is
 * still coming.
 *
 * React Query does this job in Play's own two apps, and this app deliberately
 * does not use it: the point of a demo is to show how little is needed to talk
 * to the API, and a caching layer would hide the thing worth seeing — that every
 * screen here is one `fetch` with a bearer token on it. What is left is this,
 * twenty lines, which is honest about being twenty lines.
 *
 * `deps` are the inputs the request depends on, spelled out by the caller
 * because the function is rebuilt on every render and cannot be compared, and
 * `enabled` is for the reads that must not be attempted at all yet — a page that
 * needs a credential asking the API a question before there is one gets a 401
 * and puts it in the console, which is noise rather than information.
 */
export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(
  run: () => Promise<T>,
  deps: unknown[],
  enabled = true,
): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    run()
      .then((result) => {
        // A response for a lesson somebody has already navigated away from must
        // not overwrite the one they are looking at.
        if (cancelled) return;
        setData(result);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(undefined);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  return { data, error, loading, reload };
}
