'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { GraduationCapIcon, Loader2Icon, ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { ApiError, api } from '@play/api';
import { useAuthorizationDescription } from '@api/modules/oauth/oauth.queries';
import { useAuthStatus } from '@play/auth';
import type { OAuthAuthorizationParams } from '@play/types';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { AppMark } from '@/components/oauth/app-mark';
import { ScopeGrantRow } from '@/components/oauth/scope-list';
import { authorizationParamsFrom, authorizationRedirectUrl } from '@/lib/oauth-authorize';

/**
 * The consent screen: the one page in the studio a person reaches without
 * meaning to, on their way from somebody else's app.
 *
 * A client sends a browser here with an authorization request in the query
 * string; this page asks the API what that request is, draws what the app is and
 * what it wants, and — on "Allow" — sends the browser to the app's redirect URI
 * with the code in it. Everything on this page is a decision about *somebody
 * else's* software acting on *this person's* account, which is why it is written
 * to be read rather than clicked.
 *
 * Four rules, each of which is the difference between a consent screen and a
 * phishing page:
 *
 * 1. **Nothing is redirected to until the API has validated it.** The request is
 *    read out of the query string and handed to the API unchanged, and every URI
 *    this page ever navigates to — the code, the refusal, and the cancellation —
 *    is the one the *API* returned, matched against the app's registered list.
 * 2. **A refusal that cannot be reported is shown, not forwarded.** If the API
 *    answers 400, the client or its redirect URI is unverified: there is no
 *    verified place to send a browser, so an error screen is drawn here and
 *    nothing moves.
 * 3. **A refusal that *can* be reported goes to the app.** A scope the app is not
 *    registered for is its author's mistake, and its author is who can fix it:
 *    the browser goes back to the redirect URI with `error=` in it, which is what
 *    every OAuth library is already waiting for.
 * 4. **Cancelling is an answer.** "Cancel" redirects with `error=access_denied`,
 *    so an app learns that somebody said no instead of hanging on a page that
 *    never comes back.
 */
function AuthorizeScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const status = useAuthStatus();

  const parsed = authorizationParamsFrom(search);
  /**
   * The request as the query string carried it, or nothing when it is
   * incomplete. Every hook above the guard below takes this — hooks cannot be
   * skipped — and everything after it works from `parsed.params`, which the
   * narrowing has made non-optional.
   */
  const requested = parsed.ok ? parsed.params : null;

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  /**
   * Set when the API has refused a request in a way this page cannot pass on.
   *
   * Almost every refusal is either drawn here or sent to the app; this is the
   * third case, and it only happens if the API answers with a redirect URI that
   * cannot be parsed — a broken contract rather than a refused request. Saying
   * so is better than an exception thrown out of an effect, which is a blank
   * page with nothing on it.
   */
  const [unreportable, setUnreportable] = useState<string | null>(null);

  /**
   * Somebody who is not signed in leaves for the sign-in page and comes back
   * here. The path travels as `next`, and the sign-in page also keeps it as a
   * note that survives the round trip through Google — the case `?next=` alone
   * does not, because the browser leaves this app entirely.
   */
  useEffect(() => {
    if (status !== 'unauthenticated' || !requested) return;
    const next = `/oauth/authorize?${search.toString()}`;
    router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
  }, [requested, router, search, status]);

  const describe = useAuthorizationDescription(requested, status === 'authenticated');
  const approve = useMutation({
    mutationFn: (request: OAuthAuthorizationParams) => api.approveAuthorization(request),
  });

  /** A failure the API says may be reported to the app, reported to the app. */
  useEffect(() => {
    const description = describe.data;
    if (!description || description.ok) return;

    const target = authorizationRedirectUrl(description.redirectUri, {
      error: description.oauthError,
      errorDescription: description.message,
      ...(description.state ? { state: description.state } : {}),
    });

    if (target) window.location.assign(target);
    else setUnreportable(description.message);
  }, [describe.data]);

  if (!parsed.ok) {
    return (
      <Frame>
        <Notice
          title="This link is incomplete"
          body={`The address is missing ${parsed.missing.join(', ')}. An app builds this address for you — ask whoever sent you here to check its OAuth settings.`}
        />
      </Frame>
    );
  }

  const params = parsed.params;

  if (unreportable) {
    return (
      <Frame>
        <Notice
          title="This request cannot be completed"
          body={unreportable}
          detail="Nothing was shared with the app. No code was issued, and nothing was signed in on its behalf."
        />
      </Frame>
    );
  }

  // A 400 from the API: the client id or the redirect URI is unverified, so
  // there is nowhere verified to send a browser. This is the one failure that
  // ends here rather than at the app — and the reason rule 2 exists.
  //
  // Anything that is *not* a 400 — a 5xx, a network failure, a session that
  // lapsed — is a different sentence and a different screen. It is not the
  // app's fault, nothing about the request has been judged, and somebody who is
  // mid-flow at a third party's app needs a way to try again rather than a dead
  // end that reads like a rejection of the app they came from.
  if (describe.isError) {
    const status = describe.error instanceof ApiError ? describe.error.status : undefined;

    if (status === 400) {
      return (
        <Frame>
          <Notice
            title="This request cannot be completed"
            body={describe.error.message}
            detail="Nothing was shared with the app. No code was issued, and nothing was signed in on its behalf."
          />
        </Frame>
      );
    }

    return (
      <Frame>
        <Notice
          title="We could not load this request"
          body={
            describe.error instanceof Error
              ? describe.error.message
              : 'The request could not be read.'
          }
          detail="Nothing has been shared with the app, and nothing was signed in on its behalf. This is our side rather than the app's — trying again usually works."
          action={
            <Button type="button" variant="secondary" className="mt-6" onClick={() => void describe.refetch()}>
              Try again
            </Button>
          }
        />
      </Frame>
    );
  }

  const description = describe.data;

  async function allow() {
    setApproveError(null);
    setApproving(true);
    try {
      const answer = await approve.mutateAsync(params);
      const target = authorizationRedirectUrl(answer.redirectUri, {
        code: answer.code,
        ...(answer.state ? { state: answer.state } : {}),
      });

      if (!target) {
        setApproving(false);
        setApproveError('The app’s redirect URI could not be read. Ask its author to check it.');
        return;
      }
      window.location.assign(target);
    } catch (err) {
      setApproving(false);
      setApproveError(err instanceof Error ? err.message : 'Could not complete the request');
    }
  }

  /**
   * Saying no, in the app's own terms.
   *
   * The destination is the *validated* URI, not the one in this page's address
   * bar: a client that is told "no" through a URI it chose itself is a client
   * being answered, and a URI somebody typed into a link is not.
   */
  function cancel(validatedUri: string) {
    const target = authorizationRedirectUrl(validatedUri, {
      error: 'access_denied',
      errorDescription: 'The user declined the request',
      ...(params.state ? { state: params.state } : {}),
    });

    if (target) window.location.assign(target);
    else setApproveError('The app’s redirect URI could not be read, so it cannot be told.');
  }

  if (status !== 'authenticated' || !description?.ok) {
    // Loading, on its way to the app with an error in hand, or about to be sent
    // to sign in. The session is part of this guard rather than only the
    // redirect effect, so a session that ends while this screen is open — a sign
    // -out in another tab, an expired token — cannot leave Allow and Cancel
    // sitting there to be clicked. A button that posts without a session shows
    // "Not authenticated" to somebody who pressed Allow, and an app waiting on
    // the redirect gets neither an answer nor a refusal.
    return (
      <Frame>
        <Skeleton className="h-40 w-full rounded-2xl" />
      </Frame>
    );
  }

  const app = description.app;

  return (
    <Frame>
      <div className="flex flex-col items-center text-center">
        <AppMark name={app.name} logoUrl={app.logoUrl} size="lg" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          Connect {app.name} to your Play account
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{app.description}</p>
        {app.homepageUrl && (
          <a
            href={app.homepageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 max-w-full truncate text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {app.homepageUrl}
          </a>
        )}
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border/60">
        <p className="border-b border-border/60 bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          {description.alreadyAuthorized
            ? 'You have already allowed this. These are the permissions it holds.'
            : `${app.name} is asking to:`}
        </p>
        <ul className="divide-y divide-border/60">
          {description.scopes.map((entry) => (
            <ScopeGrantRow key={entry.scope} scope={entry.scope} granted={entry.granted} />
          ))}
        </ul>
      </div>

      {approveError && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-xs text-muted-foreground">{approveError}</p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-2 sm:flex-row-reverse sm:justify-center">
        <Button
          type="button"
          onClick={() => void allow()}
          disabled={approving}
          className="sm:min-w-32"
        >
          {approving ? <Loader2Icon className="animate-spin" /> : null}
          {description.alreadyAuthorized ? 'Allow again' : 'Allow'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => cancel(description.redirectUri)}
          className="sm:min-w-32"
        >
          Cancel
        </Button>
      </div>

      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          You can take this back at any time from{' '}
          <Link href="/oauth/connections" className="underline underline-offset-4">
            Connected apps
          </Link>
          . Allowing does not give {app.name} your password, and it cannot act as anybody but you.
        </span>
      </p>
    </Frame>
  );
}

/** A windowful with the request centred in it, as the sign-in screen is. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-5 flex items-center justify-center gap-1.5 text-sm font-medium tracking-tight">
          <GraduationCapIcon className="size-4" />
          Play
        </div>
        <div className="rounded-3xl border border-border/60 bg-card p-7 text-card-foreground shadow-sm">
          {children}
        </div>
      </div>
    </main>
  );
}

/** A refusal this page owns, rather than one the app is told about. */
function Notice({
  title,
  body,
  detail,
  action,
}: {
  title: string;
  body: string;
  detail?: string;
  /** What the reader can do about it. Absent when there is nothing. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlertIcon className="size-5" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {detail && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{detail}</p>}
      {action ?? (
        <Button asChild variant="secondary" className="mt-6">
          <Link href="/home">Go to Play</Link>
        </Button>
      )}
    </div>
  );
}

/**
 * `useSearchParams` needs a suspense boundary above it in the App Router, and a
 * consent screen that rendered before the query string was readable would be one
 * that refused every request it was given.
 */
export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <Frame>
          <Skeleton className="h-40 w-full rounded-2xl" />
        </Frame>
      }
    >
      <AuthorizeScreen />
    </Suspense>
  );
}
