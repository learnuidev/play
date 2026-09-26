'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BuildingIcon, Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateOrganization } from '@/modules/organization/organization.queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

/** Same rule the backend applies, minus the random suffix it appends. */
function slugBase(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export function OrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateOrganization();

  const trimmedName = name.trim();
  const tooShort = trimmedName.length > 0 && trimmedName.length < MIN_NAME_LENGTH;
  const base = slugBase(trimmedName);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!trimmedName) {
      setError('Name is required');
      return;
    }
    if (trimmedName.length < MIN_NAME_LENGTH) {
      setError(`Name must be at least ${MIN_NAME_LENGTH} characters`);
      return;
    }

    try {
      const { organization } = await create.mutateAsync({
        name: trimmedName,
        description: description.trim(),
      });
      toast.success(`${organization.name} created`);
      router.push(`/o/${organization.orgId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create organization';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="org-name">Name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Learning"
            maxLength={MAX_NAME_LENGTH}
            autoFocus
          />
          {tooShort ? (
            <p className="text-xs text-destructive">
              Name must be at least {MIN_NAME_LENGTH} characters
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {base ? (
                <>
                  Workspace address:{' '}
                  <span className="font-mono text-foreground/80">{base}-••••••</span>
                </>
              ) : (
                `${MAX_NAME_LENGTH} characters max`
              )}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="org-description">Description</Label>
          <Textarea
            id="org-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this organization is for (optional)"
            maxLength={MAX_DESCRIPTION_LENGTH}
            rows={3}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <BuildingIcon className="size-4 shrink-0" />
        <span>You will be the organization&apos;s admin.</span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.push('/organizations')}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || !trimmedName || tooShort}>
          {create.isPending ? <Loader2Icon className="animate-spin" /> : <BuildingIcon />}
          {create.isPending ? 'Creating…' : 'Create organization'}
        </Button>
      </div>
    </form>
  );
}
