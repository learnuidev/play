'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightIcon,
  CheckIcon,
  KeyRoundIcon,
  Loader2Icon,
  ShieldOffIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCreateApiKey, useRevokeApiKey } from '@play/api';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { usePlayground } from './playground-context';

/** What a key made from this page is called in the keys list afterwards. */
const PLAYGROUND_KEY_NAME = 'Docs playground';

/** A secret shown as enough of itself to recognize, and not enough to use. */
function masked(secret: string): string {
  if (secret.length <= 20) return `${secret.slice(0, 6)}…`;
  return `${secret.slice(0, 14)}…${secret.slice(-4)}`;
}

/**
 * The credential the rest of the page runs on.
 *
 * Two ways in, because the API only ever shows a secret once and neither way
 * suits everybody. A reader who saved their key when they made it pastes it
 * here; a reader who did not — or who is reading this before making one — has
 * this page make a key for them, which it can do because they are signed in.
 *
 * The pasted key is kept in this tab and sent to nothing but the API. That is
 * the same trust the studio's own screens already extend to a session token, and
 * it is worth saying out loud on the one page where somebody types a credential
 * into a box.
 */
export function CredentialPanel() {
  const { credential, ready, useKey, forget } = usePlayground();
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState('');
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();

  const activeKey = credential?.kind === 'key' ? credential : null;

  async function createForThisTab() {
    try {
      const { key, secret } = await create.mutateAsync({ name: PLAYGROUND_KEY_NAME });
      useKey({ kind: 'key', secret, label: key.name, keyId: key.keyId });
      toast.success('Made a key for this tab', {
        description: `It is called “${PLAYGROUND_KEY_NAME}” in your key list, so you can revoke it from there too.`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create a key');
    }
  }

  async function revokeThisKey() {
    if (!activeKey?.keyId) return;
    try {
      await revoke.mutateAsync(activeKey.keyId);
      forget();
      toast.success('Revoked, and forgotten by this tab');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke the key');
    }
  }

  function savePasted() {
    const secret = draft.trim();
    if (!secret) return;
    useKey({ kind: 'key', secret, label: masked(secret) });
    setDraft('');
    setPasting(false);
    toast.success('Key saved for this tab');
  }

  // Nothing is decided until the store has been read, or the panel would offer
  // to make a key to somebody who already has one.
  if (!ready) {
    return (
      <section id="try-it" className="scroll-mt-24 rounded-3xl border border-border/60 bg-card p-6">
        <div className="h-24 animate-pulse rounded-2xl bg-muted/50" />
      </section>
    );
  }

  return (
    <section
      id="try-it"
      className="scroll-mt-24 rounded-3xl border border-border/60 bg-card p-6 text-card-foreground shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">Try it here</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Every endpoint below has a Send button. Requests go from this browser straight to the
            API, so what you see is the real response — status, timing and body.
          </p>
        </div>
        {activeKey && (
          <Badge variant="secondary" className="shrink-0 font-medium">
            Ready
          </Badge>
        )}
      </div>

      {activeKey ? (
        <div className="mt-6 grid gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
              <CheckIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {activeKey.keyId ? PLAYGROUND_KEY_NAME : 'Your key'}
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {masked(activeKey.secret)}
              </p>
            </div>
            {activeKey.keyId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                disabled={revoke.isPending}
                onClick={() => void revokeThisKey()}
              >
                {revoke.isPending ? <Loader2Icon className="animate-spin" /> : <ShieldOffIcon />}
                Revoke
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={forget}>
              Forget
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Kept in this tab and sent only to the API. A key made here is yours rather than an
            organization’s, so the organization endpoint below will refuse it — that one needs a key
            made for the organization, which the{' '}
            <Link href="/api-keys" className="underline underline-offset-4 hover:text-foreground">
              keys page
            </Link>{' '}
            can do.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4">
          {pasting ? (
            <div className="grid gap-2">
              <Label htmlFor="playground-key">Paste an API key</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="playground-key"
                  type="password"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') savePasted();
                  }}
                  placeholder="play_sk_…"
                  autoComplete="off"
                  autoFocus
                  className="min-w-0 flex-1 font-mono"
                />
                <Button type="button" disabled={!draft.trim()} onClick={savePasted}>
                  Use this key
                </Button>
                <Button type="button" variant="ghost" onClick={() => setPasting(false)}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                A key is only ever shown once, when it is made, so this is the copy you saved.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={create.isPending} onClick={() => void createForThisTab()}>
                {create.isPending ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
                Make a key for this tab
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPasting(true)}>
                I already have one
              </Button>
              <Button asChild variant="ghost">
                <Link href="/api-keys">
                  Manage keys
                  <ArrowRightIcon />
                </Link>
              </Button>
            </div>
          )}

          <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Requests are real. A key made here is a normal key for your account — you can see it,
              and revoke it, on the keys page at any time. Endpoints that change something really do
              change it, which is why they send the example values until you edit them.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
