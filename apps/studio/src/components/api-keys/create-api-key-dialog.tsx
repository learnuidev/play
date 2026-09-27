'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRightIcon, KeyRoundIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { CreateApiKeyResponse } from '@play/types';
import { useCreateApiKey } from '@api/modules/api-key/api-key.queries';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ui/components/ui/dialog';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { cn } from '@ui/lib/utils';
import { apiUrl } from '@/lib/api-base';
import { CopyButton } from '@/components/copy-button';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 60;

export interface ScopableOrganization {
  orgId: string;
  name: string;
}

/**
 * Makes an API key, and shows the secret the one time it exists.
 *
 * Two steps in one dialog, because the second is not optional: the API stores a
 * hash of the secret and nothing else, so a dialog that closed on success would
 * close on a credential nobody has. The reveal step is the whole point of the
 * flow, and it is deliberately the last thing between the reader and a key that
 * works — copy it, and the cURL right below it proves it.
 *
 * The organization is chosen here rather than on the key afterwards because it
 * is a decision about what the key *is*: a key made for an organization can be
 * seen and cut off by its admins, and reaches that organization's unpublished
 * courses as well as the public catalog.
 */
export function CreateApiKeyDialog({
  organizations,
  trigger,
}: {
  organizations: ScopableOrganization[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [created, setCreated] = useState<CreateApiKeyResponse | null>(null);

  const create = useCreateApiKey();

  const trimmed = name.trim();
  const canSubmit =
    trimmed.length >= MIN_NAME_LENGTH && trimmed.length <= MAX_NAME_LENGTH && !create.isPending;

  function reset() {
    setCreated(null);
    setName('');
    setOrganizationId('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    try {
      const response = await create.mutateAsync({
        name: trimmed,
        ...(organizationId ? { organizationId } : {}),
      });
      setCreated(response);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the key');
    }
  }

  const curl = created
    ? `curl ${apiUrl('/v1/me')} \\\n  -H "x-api-key: ${created.secret}"`
    : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your key now</DialogTitle>
              <DialogDescription>
                It is shown once. We store a hash of it and cannot show it again — if you lose it,
                revoke it and make another.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="api-key-secret">Your key</Label>
                <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
                  <code
                    id="api-key-secret"
                    className="min-w-0 flex-1 break-all font-mono text-xs"
                  >
                    {created.secret}
                  </code>
                  <CopyButton value={created.secret} label="Copy key" variant="secondary" />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="api-key-curl">Try it</Label>
                <div className="relative rounded-xl border bg-muted/40 p-3">
                  <pre
                    id="api-key-curl"
                    className="overflow-x-auto font-mono text-xs leading-relaxed"
                  >
                    {curl}
                  </pre>
                  <div className="mt-2 flex justify-end">
                    <CopyButton value={curl} label="Copy command" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Send it as an <span className="font-mono">x-api-key</span> header on every call.
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-xs text-muted-foreground">
                  Treat it like a password. It ends up in logs, shells and CI variables, and anyone
                  holding it can read everything it reaches.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={reset}>
                Make another
              </Button>
              <Button asChild variant="secondary">
                <Link href="/docs" onClick={() => setOpen(false)}>
                  Read the docs
                  <ArrowRightIcon />
                </Link>
              </Button>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                A key calls the Play API from your own code — no sign-in, no token, one header.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="api-key-name">What is it for?</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nightly reporting"
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="off"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  A name you will recognize in six months, when deciding which key to cut off.
                </p>
              </div>

              {organizations.length > 0 && (
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-sm font-medium leading-none">What it reaches</legend>
                  <div className="grid gap-2">
                    <ScopeOption
                      selected={organizationId === ''}
                      onSelect={() => setOrganizationId('')}
                      title="Only me"
                      description="The public catalog: courses their authors have published."
                    />
                    {organizations.map((organization) => (
                      <ScopeOption
                        key={organization.orgId}
                        selected={organizationId === organization.orgId}
                        onSelect={() => setOrganizationId(organization.orgId)}
                        title={organization.name}
                        description="Every course in the organization, published or not. Its admins can see this key and revoke it."
                      />
                    ))}
                  </div>
                </fieldset>
              )}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={!canSubmit}>
                  {create.isPending ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
                  Create key
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One answer to "what does this key reach", as a card you pick. */
function ScopeOption({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
        selected ? 'border-ring bg-muted/50' : 'hover:bg-muted/40',
      )}
    >
      <input
        type="radio"
        name="api-key-scope"
        checked={selected}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0 accent-foreground"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
