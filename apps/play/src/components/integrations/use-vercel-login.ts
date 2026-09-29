"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LogLine, VercelLoginEvent, VercelLoginView } from "@/lib/types";

/**
 * The Vercel sign-in, as the page sees it.
 *
 * One stream, open for as long as the page is, because the thing it carries is
 * the state of a run rather than a request: the flow outlives the page, so a
 * reload has to be able to rejoin one that is already waiting for a browser.
 * Lines are batched on an animation frame for the reason the other transcripts
 * are — a package manager prints in bursts, and one render per line is a card
 * that stutters while it works.
 */
export interface VercelLoginState {
  login: VercelLoginView | null;
  lines: LogLine[];
  /** A POST is in flight; the run itself reports `running` once it is up. */
  starting: boolean;
  error: string | null;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
}

export function useVercelLogin(): VercelLoginState {
  const [login, setLogin] = useState<VercelLoginView | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buffer = useRef<LogLine[]>([]);
  const frame = useRef<number | null>(null);
  const source = useRef<EventSource | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    if (buffer.current.length === 0) return;
    const incoming = buffer.current;
    buffer.current = [];
    setLines((current) => {
      const next = [...current, ...incoming];
      // The server keeps 400 lines and so does the mirror, or the two drift on a
      // flow that prints for a long time.
      return next.length > 400 ? next.slice(next.length - 400) : next;
    });
  }, []);

  /**
   * (Re)opening the stream is not only a mount-time thing.
   *
   * The server subscribes a connection to *the run that exists when it
   * connects* — and on a page that has just loaded, or one whose last sign-in is
   * over, that is the previous run. So a Connect pressed from here has to open a
   * new connection to be followed; without it the card keeps showing the last
   * attempt, device URL and all, while the sign-in actually waiting for a
   * browser goes unmentioned in the run nobody is subscribed to. The deploy page
   * reopens its stream for exactly this reason.
   */
  const open = useCallback(() => {
    source.current?.close();

    const events = new EventSource("/api/vercel/login/events");
    source.current = events;

    events.onmessage = (message) => {
      let event: VercelLoginEvent;
      try {
        event = JSON.parse(message.data) as VercelLoginEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case "login":
        case "end":
          setLogin(event.login);
          break;
        case "log":
          buffer.current.push(event.line);
          if (frame.current === null) frame.current = requestAnimationFrame(flush);
          break;
        default:
          break;
      }
    };

    events.onerror = () => {
      if (events.readyState === EventSource.CLOSED) {
        setError("The console lost its connection to the server. Refresh the page.");
      }
    };
  }, [flush]);

  useEffect(() => {
    open();
    return () => {
      source.current?.close();
      source.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [open]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    // A new run starts a new transcript: the server clears its own buffer, and a
    // mirror that kept the last one would show two sign-ins interleaved.
    buffer.current = [];
    setLines([]);
    try {
      const response = await fetch("/api/vercel/login", { method: "POST" });
      const body = (await response.json()) as { login?: VercelLoginView; error?: string };
      if (!response.ok || !body.login) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setLogin(body.login);
      // Now that there is a run to follow, follow it — see `open`.
      open();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }, [open]);

  const cancel = useCallback(async () => {
    try {
      const response = await fetch("/api/vercel/login", { method: "DELETE" });
      const body = (await response.json()) as { login?: VercelLoginView };
      if (body.login) setLogin(body.login);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  return { login, lines, starting, error, start, cancel };
}
