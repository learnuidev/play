'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightIcon,
  BuildingIcon,
  CheckIcon,
  ChevronDownIcon,
  KeyRoundIcon,
  Loader2Icon,
  ShieldOffIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCreateApiKey, useOrganizations, useRevokeApiKey } from '@play/api';
import type { OrganizationSummary } from '@play/types';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { describeKey } from '@/lib/api-playground';
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
 * The key it makes can be made for an organization, and that is a decision worth
 * putting here rather than leaving to the keys page: half the endpoints below
 * answer only for a key made for an organization, and a reader who has just been
 * refused a 403 by one of them should be able to fix that on the page that
 * refused them. "Only me" stays the default — it is the key that can read the
 * least, and the one nobody else can revoke.
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
  /** The organization the next key will be made for. Empty means "only me". */
  const [organizationId, setOrganizationId] = useState('');
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();

  const organizationsQuery = useOrganizations();
  const organizations = organizationsQuery.data?.organizations ?? [];
  const target = organizations.find((organization) => organization.orgId === organizationId);

  const activeKey = credential?.kind === 'key' ? credential : null;

  async function createForThisTab() {
    try {
      const { key, secret } = await create.mutateAsync({
        name: PLAYGROUND_KEY_NAME,
        ...(organizationId ? { organizationId } : {}),
      });
      useKey({
        kind: 'key',
        secret,
        label: key.name,
        keyId: key.keyId,
        ...(organizationId
          ? {
              organizationId: key.organizationId ?? organizationId,
              organizationName: key.organizationName ?? target?.name ?? 'your organization',
            }
          : {}),
      });
      toast.success(target ? `Made a key for ${target.name}` : 'Made a key for this tab', {
        description: target
          ? `It is called “${PLAYGROUND_KEY_NAME}”, and it is in ${target.name}’s key list as well as yours — its admins can revoke it there.`
          : `It is called “${PLAYGROUND_KEY_NAME}” in your key list, so you can revoke it from there too.`,
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

  /**
   * A pasted key is asked what it is, and stored while the answer is coming.
   *
   * Somebody pasting a key usually pasted the one they made for an organization
   * — that is what the organization endpoints below need — and a key that says
   * which organization it reaches is a page that fills that organization in
   * wherever a card asks for one and offers that organization's courses. The key
   * is installed first, so a slow or refused `/v1/me` costs the page its extra
   * specificity rather than costing the reader their key.
   */
  async function savePasted() {
    const secret = draft.trim();
    if (!secret) return;
    setDraft('');
    setPasting(false);

    useKey({ kind: 'key', secret, label: masked(secret) });

    const description = await describeKey(secret);
    if (description) useKey({ kind: 'key', secret, label: masked(secret), ...description });

    toast.success(
      description?.organizationName
        ? `Key saved — it was made for ${description.organizationName}`
        : 'Key saved for this tab',
    );
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
                {activeKey.organizationName && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · made for {activeKey.organizationName}
                  </span>
                )}
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
            Kept in this tab and sent only to the API.{' '}
            {activeKey.organizationName ? (
              <>
                Made for <span className="font-medium">{activeKey.organizationName}</span>, so it
                reaches that organization’s courses — the unpublished ones included — and its admins
                can see it and revoke it beside you.
              </>
            ) : (
              <>
                This one acts as you rather than as an organization, so the organization endpoints
                below will refuse it with a <span className="font-mono">403</span>. Forget it, pick
                an organization beside the button above, and make another — or make one for the
                organization from the{' '}
                <Link href="/api-keys" className="underline underline-offset-4 hover:text-foreground">
                  keys page
                </Link>
                .
              </>
            )}
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
                    if (event.key === 'Enter') void savePasted();
                  }}
                  placeholder="play_sk_…"
                  autoComplete="off"
                  autoFocus
                  className="min-w-0 flex-1 font-mono"
                />
                <Button type="button" disabled={!draft.trim()} onClick={() => void savePasted()}>
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
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={create.isPending} onClick={() => void createForThisTab()}>
                {create.isPending ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
                Make a key for this tab
              </Button>
              {/* Only offered to somebody who belongs to an organization: with
                  none to name, a picker would be a question with one answer. */}
              {organizations.length > 0 && (
                <KeyScopeMenu
                  organizations={organizations}
                  value={organizationId}
                  onChange={setOrganizationId}
                />
              )}
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
              Requests are real. A key made here is a normal key — it is in the keys page, where you
              can revoke it, and an organization’s key is in that organization’s list as well.
              Endpoints that change something really do change it, which is why they send the example
              values until you edit them.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * What the next key will reach: the reader, or one of their organizations.
 *
 * The same question the keys page asks, in one control rather than a dialog,
 * because the answer here is not a decision somebody came to make — it is a
 * correction. Half the endpoints below answer only for an organization's key,
 * and the moment a reader needs to say so is the moment one of them has just
 * told them no.
 *
 * "Only me" is the first item and the default: a personal key is the one that
 * reads the least, and the one no organization's admin can revoke.
 */
function KeyScopeMenu({
  organizations,
  value,
  onChange,
}: {
  organizations: OrganizationSummary[];
  value: string;
  onChange: (orgId: string) => void;
}) {
  const selected = organizations.find((organization) => organization.orgId === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" aria-label="What this key reaches">
          <BuildingIcon />
          {selected ? selected.name : 'Only me'}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          What this key reaches
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => onChange('')} className="items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate">Only me</span>
            <span className="block text-xs text-muted-foreground">
              Acts as you: the public catalog, and the courses you may read.
            </span>
          </span>
          {value === '' && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization.orgId}
            onSelect={() => onChange(organization.orgId)}
            className="items-start gap-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{organization.name}</span>
              <span className="block text-xs text-muted-foreground">
                Every course it owns, published or not. Its admins can revoke this key.
              </span>
            </span>
            {value === organization.orgId && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
