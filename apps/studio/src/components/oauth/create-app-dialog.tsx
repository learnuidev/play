'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightIcon, Loader2Icon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiScope, CreateOAuthAppResponse } from '@play/types';
import { useCreateOAuthApp } from '@api/modules/oauth/oauth.queries';
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
import { Textarea } from '@ui/components/ui/textarea';
import { AppMark } from '@/components/oauth/app-mark';
import { ScopeChecklist } from '@/components/oauth/scope-list';
import { CopyButton } from '@/components/copy-button';
import { DEFAULT_APP_SCOPE_SELECTION } from '@/lib/oauth-scopes';
import { redirectUrisFromText } from '@/lib/oauth-form';
import { apiUrl } from '@/lib/api-base';

/**
 * Registers an OAuth app, and shows the client secret the one time it exists.
 *
 * Registering an app is not a form that ends when it is submitted: what the
 * caller walks away with is a client id, a secret, and the redirect URIs they
 * have to configure their own side with. So the second step is the point — the
 * same shape the API keys dialog uses, and for the same reason, which is that
 * the service stores a hash and cannot show the secret again.
 *
 * A public client gets no secret at all, and the dialog says so in place of the
 * reveal: a browser app holding a "secret" is holding nothing, and a screen that
 * handed one over would teach its author that their app is authenticated when
 * anything holding the string is.
 */
export function CreateOAuthAppDialog({ trigger }: { trigger: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreateOAuthAppResponse | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [redirectUrisText, setRedirectUrisText] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(DEFAULT_APP_SCOPE_SELECTION);
  const [isPublic, setIsPublic] = useState(false);

  const create = useCreateOAuthApp();

  const redirectUris = redirectUrisFromText(redirectUrisText);
  /** The first URI, or nothing: what the example command has to point at. */
  const exampleRedirectUri = redirectUris[0];
  const canSubmit =
    name.trim().length >= 2 &&
    description.trim().length > 0 &&
    redirectUris.length > 0 &&
    scopes.length > 0 &&
    !create.isPending;

  function reset() {
    setCreated(null);
    // The mutation's own result is dropped too, and that is a credential
    // rather than tidiness: TanStack keeps a settled mutation in its cache
    // until the observer goes, so a secret left there outlives the dialog that
    // showed it once — for as long as this page is mounted, and for the cache's
    // own collection window after it. Closing the dialog is the moment to
    // forget it, and this is where the dialog closes.
    create.reset();
    setName('');
    setDescription('');
    setHomepageUrl('');
    setLogoUrl('');
    setRedirectUrisText('');
    setScopes(DEFAULT_APP_SCOPE_SELECTION);
    setIsPublic(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    try {
      const response = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        ...(homepageUrl.trim() ? { homepageUrl: homepageUrl.trim() } : {}),
        ...(logoUrl.trim() ? { logoUrl: logoUrl.trim() } : {}),
        redirectUris,
        scopes,
        isPublic,
      });
      setCreated(response);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not register the app');
    }
  }

  const redirectUri = exampleRedirectUri ?? 'YOUR_REDIRECT_URI';
  const curl = created
    ? `curl -X POST ${apiUrl('/oauth/token')} \\\n  -d grant_type=authorization_code \\\n  -d code=$CODE -d redirect_uri=${redirectUri} \\\n  -d code_verifier=$VERIFIER \\\n  -d client_id=${created.app.clientId}${
        created.secret ? ` \\\n  -d client_secret=${created.secret}` : ''
      }`
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
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.app.name} is registered</DialogTitle>
              <DialogDescription>
                {created.secret
                  ? 'Copy the client secret now. It is shown once — we store a hash, so it cannot be shown again. If you lose it, rotate it.'
                  : 'This is a public client, so it has no secret. It proves itself with PKCE, which your client library already does.'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                <AppMark name={created.app.name} logoUrl={created.app.logoUrl} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{created.app.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {created.app.isPublic ? 'Public client' : 'Confidential client'}
                  </p>
                </div>
              </div>

              <CredentialField label="Client id" value={created.app.clientId} />
              {created.secret && <CredentialField label="Client secret" value={created.secret} />}

              {/* A heading rather than a `Label`: a label names a form control,
                  and the thing under this one is a `<pre>` — which is not a
                  control, so the label would name nothing and clicking it would
                  do nothing. */}
              <div className="grid gap-2">
                <p className="text-sm font-medium leading-none">Exchanging the code</p>
                <div className="relative rounded-xl border bg-muted/40 p-3">
                  <pre
                    id="oauth-app-curl"
                    className="overflow-x-auto font-mono text-xs leading-relaxed"
                  >
                    {curl}
                  </pre>
                  <div className="mt-2 flex justify-end">
                    <CopyButton value={curl} label="Copy command" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Send a person to <span className="font-mono">/oauth/authorize</span> with a
                  challenge derived from <span className="font-mono">$VERIFIER</span> first; this is
                  the call their browser comes back from. The whole flow is worked through in the{' '}
                  <a href="/docs#oauth" className="underline underline-offset-4">
                    API reference
                  </a>
                  .
                </p>
              </div>

              {created.secret && (
                <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <p className="text-xs text-muted-foreground">
                    A client secret belongs on a server. If your app runs in a browser, in a desktop
                    bundle or in a CLI, register it as a public client instead — a secret shipped
                    inside the app is not a secret.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={reset}>
                Register another
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  router.push(`/oauth/apps/${created.app.appId}`);
                }}
              >
                Open settings
                <ArrowRightIcon />
              </Button>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Register an OAuth app</DialogTitle>
              <DialogDescription>
                Your app sends people to Play to sign in and ask for permission. It then calls the
                API as them, with only what they allowed.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={submit} className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="oauth-app-name">Name</Label>
                <Input
                  id="oauth-app-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Team dashboard"
                  maxLength={60}
                  autoComplete="off"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Shown on the consent screen. Naming your company is normal; naming somebody
                  else&apos;s is not.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="oauth-app-description">What does it do?</Label>
                <Textarea
                  id="oauth-app-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Shows your team's courses and progress in one place."
                  maxLength={280}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  One sentence, under the name on the consent screen. This is what somebody reads
                  before deciding whether to trust you.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="oauth-app-homepage">Homepage</Label>
                  <Input
                    id="oauth-app-homepage"
                    value={homepageUrl}
                    onChange={(event) => setHomepageUrl(event.target.value)}
                    placeholder="https://example.com"
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="oauth-app-logo">Logo URL</Label>
                  <Input
                    id="oauth-app-logo"
                    value={logoUrl}
                    onChange={(event) => setLogoUrl(event.target.value)}
                    placeholder="https://example.com/logo.png"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="oauth-app-redirects">Redirect URIs</Label>
                <Textarea
                  id="oauth-app-redirects"
                  value={redirectUrisText}
                  onChange={(event) => setRedirectUrisText(event.target.value)}
                  placeholder={'https://example.com/auth/play/callback'}
                  rows={3}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  One per line, and matched exactly — no wildcards. This is where we send somebody
                  back with their authorization code, so it is the one setting worth getting right.
                  Plain http is allowed only for localhost.
                </p>
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium leading-none">
                  What may it ask for?
                </legend>
                <ScopeChecklist selected={scopes} onChange={setScopes} />
                <p className="text-xs text-muted-foreground">
                  The most your app may ever ask for. A person can still refuse, and their consent
                  screen offers exactly this list.
                </p>
              </fieldset>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(event) => setIsPublic(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-foreground"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    This app cannot keep a secret
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    For a browser app, a desktop app or a CLI. It gets no client secret and
                    authenticates with PKCE alone. Untick this only for a server you control.
                  </span>
                </span>
              </label>

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={!canSubmit}>
                  {create.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                  Register app
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One credential, in a box you can copy out of. */
function CredentialField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium leading-none">{label}</p>
      <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs">{value}</code>
        <CopyButton value={value} label="Copy" variant="secondary" />
      </div>
    </div>
  );
}
