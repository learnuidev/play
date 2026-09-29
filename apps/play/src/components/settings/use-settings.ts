"use client";

import { useCallback, useEffect, useState } from "react";

import type { EnvironmentSettings, EnvironmentSettingsInput } from "@/lib/types";

/**
 * One environment's settings, as the page sees them.
 *
 * Reloaded whenever the selected stage changes, because the settings *are* the
 * stage — switching environments switches the form's subject, and a form that
 * kept the previous one's values would be the most expensive kind of stale.
 */
export interface SettingsState {
  settings: EnvironmentSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** The last save succeeded, for a moment. */
  saved: boolean;
  dismissError: () => void;
  reload: () => void;
  save: (input: EnvironmentSettingsInput) => Promise<boolean>;
}

export function useSettings(stage: string): SettingsState {
  const [settings, setSettings] = useState<EnvironmentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/environments/${encodeURIComponent(stage)}/settings`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          settings?: EnvironmentSettings;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.settings) {
          setSettings(null);
          setError(body.error ?? `The settings for ${stage} could not be read.`);
          return;
        }
        setSettings(body.settings);
      })
      .catch(() => {
        if (!cancelled) setError(`The settings for ${stage} could not be read.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [stage, nonce]);

  // A save is about one environment; moving to another clears the confirmation
  // rather than letting it follow you there.
  useEffect(() => {
    setSaved(false);
  }, [stage]);

  const save = useCallback(
    async (input: EnvironmentSettingsInput) => {
      setSaving(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/environments/${encodeURIComponent(stage)}/settings`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        const body = (await response.json()) as {
          settings?: EnvironmentSettings;
          error?: string;
        };
        if (!response.ok || !body.settings) {
          setError(body.error ?? "The settings could not be saved.");
          return false;
        }
        setSettings(body.settings);
        setSaved(true);
        return true;
      } catch {
        setError("The settings could not be saved.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [stage],
  );

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return {
    settings,
    loading,
    saving,
    error,
    saved,
    dismissError: () => setError(null),
    reload,
    save,
  };
}
