"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  EnvironmentSettings,
  EnvironmentSettingsInput,
  SettingsWriteView,
  SigningKeyView,
} from "@/lib/types";

/**
 * One environment's settings, as the page sees them.
 *
 * Reloaded whenever the selected stage changes, because the settings *are* the
 * stage — switching environments switches the form's subject, and a form that
 * kept the previous one's values would be the most expensive kind of stale.
 *
 * Two things are read together and are not the same kind of thing: the values a
 * person supplies, and the CloudFront key pair, which nobody types and the
 * console creates. They share a hook because they share a question — "can this
 * environment deploy?" — and because both answers arrive in one request.
 */
export interface SettingsState {
  settings: EnvironmentSettings | null;
  /** Null when SSM could not be read — which is not the same as "no key". */
  signingKey: SigningKeyView | null;
  loading: boolean;
  saving: boolean;
  /** Creating the key is its own action: it takes no input, and is a no-op when one exists. */
  keyBusy: boolean;
  error: string | null;
  /** The last save succeeded, for a moment. */
  saved: boolean;
  /** What the last save wrote, so the page can say it rather than guess. */
  write: SettingsWriteView | null;
  /** What the last signing-key action found or did. */
  keyNote: string | null;
  dismissError: () => void;
  reload: () => void;
  save: (input: EnvironmentSettingsInput) => Promise<boolean>;
  ensureSigningKey: () => Promise<boolean>;
}

export function useSettings(stage: string): SettingsState {
  const [settings, setSettings] = useState<EnvironmentSettings | null>(null);
  const [signingKey, setSigningKey] = useState<SigningKeyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [write, setWrite] = useState<SettingsWriteView | null>(null);
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/environments/${encodeURIComponent(stage)}/settings`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          settings?: EnvironmentSettings;
          signingKey?: SigningKeyView | null;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.settings) {
          setSettings(null);
          setError(body.error ?? `The settings for ${stage} could not be read.`);
          return;
        }
        setSettings(body.settings);
        setSigningKey(body.signingKey ?? null);
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
    setWrite(null);
    setKeyNote(null);
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
          write?: SettingsWriteView;
          signingKey?: SigningKeyView | null;
          error?: string;
        };
        if (!response.ok || !body.settings) {
          setError(body.error ?? "The settings could not be saved.");
          return false;
        }
        setSettings(body.settings);
        setWrite(body.write ?? null);
        if (body.signingKey !== undefined) setSigningKey(body.signingKey);
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

  const ensureSigningKey = useCallback(async () => {
    setKeyBusy(true);
    setError(null);
    setKeyNote(null);
    try {
      const response = await fetch(
        `/api/environments/${encodeURIComponent(stage)}/signing-key`,
        { method: "POST" },
      );
      const body = (await response.json()) as {
        signingKey?: SigningKeyView;
        note?: string;
        error?: string;
      };
      if (!response.ok || !body.signingKey) {
        setError(body.error ?? "The signing key could not be created.");
        return false;
      }
      setSigningKey(body.signingKey);
      setKeyNote(body.note ?? null);
      return true;
    } catch {
      setError("The signing key could not be created.");
      return false;
    } finally {
      setKeyBusy(false);
    }
  }, [stage]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return {
    settings,
    signingKey,
    loading,
    saving,
    keyBusy,
    error,
    saved,
    write,
    keyNote,
    dismissError: () => setError(null),
    reload,
    save,
    ensureSigningKey,
  };
}
