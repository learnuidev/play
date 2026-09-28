'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRightIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { PersonAvatar } from '@play/ui';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { useSession } from '@/lib/oauth/session';
import { getIdentity, getProfile, ApiError } from '@/lib/api/v1';
import { useAsync } from '@/lib/use-async';
import type { ApiIdentityResponse, ApiProfileResponse } from '@play/types';

/**
 * What the credential is, and who it is for.
 *
 * Two calls, and between them they answer the two questions a person has just
 * after authorizing an app: what exactly did I give it, and does it know who I
 * am? `GET /v1/me` is the first — the app's name, the scopes the token actually
 * holds, and the id of the account it acts as. `GET /v1/me/profile` is the
 * second, and it is the one scope that is about a person rather than a catalog:
 * it takes `profile:read`, and an app that did not ask for it gets a 403 here
 * with the scope named.
 *
 * The panel is also where the whole point of this app is visible: the name and
 * the face below are *Play's* answer, read with a token Play issued, in an app
 * Play has never heard of.
 */
export function IdentityPanel() {
  const { signOut, tokens } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const identity = useAsync<ApiIdentityResponse>(() => getIdentity(), [tokens?.issuedAt]);
  const profile = useAsync<{ profile?: ApiProfileResponse['profile'] }>(
    () =>
      getProfile().catch((err: unknown) => {
        // A credential without `profile:read` gets a 403 here, and that is a
        // fact about the registration rather than a broken page: the panel says
        // so and shows everything else. Any other failure is a failure.
        if (err instanceof ApiError && err.status === 403) return {};
        throw err;
      }),
    [tokens?.issuedAt],
  );

  // The token rotates every hour, and the panel is the one place that should
  // stop showing a stale one.
  const [expiresIn, setExpiresIn] = useState('');
  useEffect(() => {
    if (!tokens) return;
    const update = () => {
      const minutes = Math.max(0, Math.round((tokens.expiresAt - Date.now()) / 60_000));
      setExpiresIn(minutes > 0 ? `in ${minutes} min` : 'now — renewing');
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [tokens]);

  async function disconnect() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-3xl border border-border/60 bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Connected</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              You authorized this app. Everything below was read from Play with the token you
              granted — this app has no other way of knowing any of it.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void disconnect()}
            disabled={signingOut}
          >
            {signingOut ? <Loader2Icon className="animate-spin" /> : null}
            Disconnect
          </Button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/60 p-4">
            <p className="text-xs text-muted-foreground">The credential</p>
            {identity.loading ? (
              <p className="mt-2 text-sm text-muted-foreground">Reading…</p>
            ) : identity.error ? (
              <p className="mt-2 text-sm text-destructive">{identity.error.message}</p>
            ) : (
              <>
                <p className="mt-2 text-sm font-medium">
                  {identity.data?.oauth?.app.name ?? 'An OAuth app'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  acting as{' '}
                  <span className="font-mono">
                    {identity.data?.owner.userId.slice(0, 8) ?? '—'}…
                  </span>{' '}
                  · renews {expiresIn || 'hourly'}
                </p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {(identity.data?.scopes ?? []).map((scope) => (
                    <li key={scope}>
                      <Badge variant="secondary" className="font-mono text-xs font-normal">
                        {scope}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 p-4">
            <p className="text-xs text-muted-foreground">Who you are, according to Play</p>
            {profile.loading ? (
              <p className="mt-2 text-sm text-muted-foreground">Reading…</p>
            ) : profile.error ? (
              <div className="mt-2 flex items-start gap-2">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {profile.error.message}
                </p>
              </div>
            ) : profile.data?.profile ? (
              <div className="mt-2 flex items-center gap-3">
                <PersonAvatar
                  name={profile.data.profile.name}
                  {...(profile.data.profile.photoUrl
                    ? { photoUrl: profile.data.profile.photoUrl }
                    : {})}
                  size="lg"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{profile.data.profile.name}</p>
                  {profile.data.profile.bio ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {profile.data.profile.bio}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      No bio written yet on Play.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                This credential does not hold <span className="font-mono">profile:read</span>, so
                Play will not say who you are. Everything else on this page still works: the read
                that answers with a name is the one permission that is about a person rather than a
                catalog.
              </p>
            )}
          </div>
        </div>

        <Button asChild className="mt-5 w-fit">
          <Link href="/courses">
            Open the classroom
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </div>
  );
}
