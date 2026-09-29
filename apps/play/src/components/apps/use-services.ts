"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AppKey, LogLine, ServiceEvent, ServiceView } from "@/lib/types";

/**
 * The three frontends, as the page sees them.
 *
 * One `EventSource` for all three, because they share a page and a stream per
 * card would be three reconnects to get wrong. Lines are buffered and flushed on
 * an animation frame for the same reason the deploy's are: `next dev` prints a
 * burst on boot, and one render per line is a card that stutters while it starts.
 */

export interface ServicesState {
  services: ServiceView[];
  /** Ports something else is already listening on. */
  occupied: number[];
  lines: Map<AppKey, LogLine[]>;
  pending: AppKey | null;
  error: string | null;
  dismissError: () => void;
  start: (app: AppKey, stage: string | null) => Promise<void>;
  stop: (app: AppKey) => Promise<void>;
  refresh: () => void;
}

export function useServices(): ServicesState {
  const [services, setServices] = useState<ServiceView[]>([]);
  const [occupied, setOccupied] = useState<number[]>([]);
  const [lines, setLines] = useState<Map<AppKey, LogLine[]>>(new Map());
  const [pending, setPending] = useState<AppKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buffer = useRef<Array<{ app: AppKey; line: LogLine }>>([]);
  const frame = useRef<number | null>(null);
  const source = useRef<EventSource | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    if (buffer.current.length === 0) return;
    const incoming = buffer.current;
    buffer.current = [];
    setLines((current) => {
      const next = new Map(current);
      for (const { app, line } of incoming) {
        const existing = next.get(app);
        // The server caps its own buffer at 400 lines; the mirror has to hold
        // the same window or the two drift apart on a long-running dev server.
        const merged = existing ? [...existing, line] : [line];
        next.set(app, merged.length > 400 ? merged.slice(merged.length - 400) : merged);
      }
      return next;
    });
  }, []);

  const push = useCallback(
    (app: AppKey, line: LogLine) => {
      buffer.current.push({ app, line });
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const upsert = useCallback((service: ServiceView) => {
    setServices((current) => {
      const index = current.findIndex((candidate) => candidate.app === service.app);
      if (index === -1) return [...current, service];
      const next = [...current];
      next[index] = service;
      return next;
    });
  }, []);

  useEffect(() => {
    const events = new EventSource("/api/services/events");

    events.onmessage = (message) => {
      let event: ServiceEvent;
      try {
        event = JSON.parse(message.data) as ServiceEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case "services":
          setServices(event.services);
          break;
        case "status":
          upsert(event.service);
          break;
        case "log":
          push(event.app, event.line);
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

    source.current = events;
    return () => {
      events.close();
      source.current = null;
    };
  }, [push, upsert]);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const response = await fetch("/api/services", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { services: ServiceView[]; occupied: number[] };
        setServices(body.services);
        setOccupied(body.occupied);
      } catch {
        // The stream is the source of truth; this only adds the port check.
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const start = useCallback(
    async (app: AppKey, stage: string | null) => {
      setPending(app);
      setError(null);
      setLines((current) => new Map(current).set(app, []));
      try {
        const response = await fetch(`/api/services/${app}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stage }),
        });
        const body = (await response.json()) as { service?: ServiceView; error?: string };
        if (!response.ok) {
          setError(body.error ?? `HTTP ${response.status}`);
          return;
        }
        if (body.service) upsert(body.service);
        refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(null);
      }
    },
    [refresh, upsert],
  );

  const stop = useCallback(
    async (app: AppKey) => {
      setPending(app);
      try {
        const response = await fetch(`/api/services/${app}`, { method: "DELETE" });
        const body = (await response.json()) as { service?: ServiceView; error?: string };
        if (!response.ok) {
          setError(body.error ?? `HTTP ${response.status}`);
          return;
        }
        if (body.service) upsert(body.service);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(null);
      }
    },
    [upsert],
  );

  return {
    services,
    occupied,
    lines,
    pending,
    error,
    dismissError: () => setError(null),
    start,
    stop,
    refresh,
  };
}
