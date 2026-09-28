'use client';

import { useEffect, useState } from 'react';
import { Loader2Icon, SaveIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiScope, OAuthApp } from '@play/types';
import { useUpdateOAuthApp } from '@api/modules/oauth/oauth.queries';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Textarea } from '@ui/components/ui/textarea';
import { ScopeChecklist } from '@/components/oauth/scope-list';
import { redirectUrisFromText, redirectUrisToText } from '@/lib/oauth-form';

/**
 * An app's settings, as one form.
 *
 * Everything an app's author can change is here rather than spread across cards,
 * because the parts are not independent: a name is what a consent screen says, a
 * redirect URI is where that screen sends somebody, and the scopes are what it
 * asks them for. Somebody editing one of those is usually editing the others.
 *
 * Two rules the form makes visible rather than surprising:
 *
 * - **The scopes are the app's ceiling, not its permissions.** Changing them ends
 *   every authorization the app holds, and the form says so, in place, before the
 *   save button — not afterwards in a toast about how many people were
 *   disconnected.
 * - **Whether a client can keep a secret is not editable.** It is a fact about
 *   where the code runs, decided when the app is registered; flipping it later
 *   would either invent a secret into a running browser app or take one away from
 *   a deployed server.
 */
export function AppSettingsForm({ app }: { app: OAuthApp }) {
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description);
  const [homepageUrl, setHomepageUrl] = useState(app.homepageUrl ?? '');
  const [logoUrl, setLogoUrl] = useState(app.logoUrl ?? '');
  const [redirectUrisText, setRedirectUrisText] = useState(redirectUrisToText(app.redirectUris));
  const [scopes, setScopes] = useState<ApiScope[]>(app.scopes);
  const [dirty, setDirty] = useState(false);

  const update = useUpdateOAuthApp(app.appId);

  /**
   * The API is the one that decides, so the form follows what came back rather
   * than what was typed: a redirect URI it refused, or a field it trimmed, is
   * reflected here instead of looking saved.
   *
   * Not while somebody is typing, though. This app is refetched whenever its
   * query is invalidated — rotating the client secret does it, and so does
   * anything else that touches the app's row — and a form that re-seeded itself
   * on every refetch would throw away the half-typed redirect URI of somebody
   * who scrolled down to rotate a secret first. Editing is the signal that the
   * server's copy is the older one; saving is what makes it new again.
   */
  useEffect(() => {
    if (dirty) return;
    setName(app.name);
    setDescription(app.description);
    setHomepageUrl(app.homepageUrl ?? '');
    setLogoUrl(app.logoUrl ?? '');
    setRedirectUrisText(redirectUrisToText(app.redirectUris));
    setScopes(app.scopes);
  }, [app, dirty]);

  /** One field edited: the form is now ahead of the server until it is saved. */
  function edit(apply: () => void) {
    apply();
    setDirty(true);
  }

  const redirectUris = redirectUrisFromText(redirectUrisText);
  const scopesChanged =
    scopes.length !== app.scopes.length || scopes.some((scope) => !app.scopes.includes(scope));
  const canSave =
    name.trim().length >= 2 &&
    description.trim().length > 0 &&
    redirectUris.length > 0 &&
    scopes.length > 0 &&
    !update.isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;

    try {
      const response = await update.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        homepageUrl: homepageUrl.trim() ? homepageUrl.trim() : null,
        logoUrl: logoUrl.trim() ? logoUrl.trim() : null,
        redirectUris,
        scopes,
      });

      setDirty(false);

      const ended = response.authorizationsEnded ?? 0;
      if (ended > 0) {
        toast.success(
          ended === 1
            ? 'Saved. 1 connection was disconnected by the scope change.'
            : `Saved. ${ended} connections were disconnected by the scope change.`,
        );
      } else {
        toast.success('Saved');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the app');
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="app-name">Name</Label>
        <Input
          id="app-name"
          value={name}
          onChange={(event) => edit(() => setName(event.target.value))}
          maxLength={60}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="app-description">What does it do?</Label>
        <Textarea
          id="app-description"
          value={description}
          onChange={(event) => edit(() => setDescription(event.target.value))}
          maxLength={280}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Shown under the app&apos;s name on the consent screen, and on the connections screen of
          everybody who has authorized it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="app-homepage">Homepage</Label>
          <Input
            id="app-homepage"
            value={homepageUrl}
            onChange={(event) => edit(() => setHomepageUrl(event.target.value))}
            placeholder="https://example.com"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="app-logo">Logo URL</Label>
          <Input
            id="app-logo"
            value={logoUrl}
            onChange={(event) => edit(() => setLogoUrl(event.target.value))}
            placeholder="https://example.com/logo.png"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="app-redirects">Redirect URIs</Label>
        <Textarea
          id="app-redirects"
          value={redirectUrisText}
          onChange={(event) => edit(() => setRedirectUrisText(event.target.value))}
          rows={3}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          One per line, matched exactly. Removing one that is in use breaks that flow only — nobody
          is disconnected by it.
        </p>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium leading-none">What may it ask for?</legend>
        <ScopeChecklist
          selected={scopes}
          onChange={(next) => edit(() => setScopes(next))}
          disabled={update.isPending}
        />
        {scopesChanged && (
          <div className="mt-2 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-xs text-muted-foreground">
              Saving this disconnects everyone who has connected the app. They agreed to the list
              above, so a changed list has to be agreed to again — the next time each of them uses
              the app, they will see the consent screen with the new permissions on it.
            </p>
          </div>
        )}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSave}>
          {update.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          Save changes
        </Button>
        {/* Only while the form still matches what was saved: an indicator that
            stayed up after further edits would be claiming the new text is
            already stored. */}
        {update.isSuccess && !dirty && (
          <span className="text-xs text-muted-foreground">Saved</span>
        )}
      </div>
    </form>
  );
}
