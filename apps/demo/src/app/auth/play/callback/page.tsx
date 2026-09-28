'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { completeAuthorization, readCallback, takeReturnTo, OAuthError } from '@/lib/oauth/client';
import { useSession } from '@/lib/oauth/session';

/**
 * Where Play sends the browser back to.
 *
 * The second leg of the flow and the only page in this app that does any work
 * without being asked: it reads `code` and `state` out of its own query string,
 * checks the state against the one parked before the redirect, and spends the
 * code for tokens.
 *
 * Two things here are worth reading twice:
 *
 * - **The state check.** A callback URL is just a URL, and anybody can send a
 *   browser to one — including one carrying a code that belongs to *them*. The
 *   state is what ties this callback to the sign-in this tab started, and a
 *   mismatch is treated as a failed sign-in rather than ignored.
 * - **The exchange happens here, in the browser, with no secret.** That is what
 *   a public client is: the code is useless without the verifier that never left
 *   session storage, and Play will not spend it for anybody else either.
 *
 * A refusal is not an error page: `error=access_denied` is what "Cancel" on the
 * consent screen looks like, and it is shown as the ordinary answer it is.
 */
function CallbackScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const { adopt } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  // React's strict mode runs effects twice in development, and a code can only
  // be spent once — the second attempt would fail and report a failure that is
  // not one.
  const spent = useRef(false);

  useEffect(() => {
    if (spent.current) return;
    spent.current = true;

    const callback = readCallback(search);

    if (callback.error) {
      setDenied(true);
      return;
    }

    completeAuthorization(callback)
      .then((tokens) => {
        adopt(tokens);
        // `replace` rather than `push`: the callback URL carries a code that has
        // just been spent, and going back to it should not re-run this page.
        router.replace(takeReturnTo());
      })
      .catch((err: unknown) => {
        setError(
          err instanceof OAuthError
            ? `${err.message}${err.code ? ` (${err.code})` : ''}`
            : 'The sign-in could not be completed.',
        );
      });
  }, [adopt, router, search]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-6 py-24 text-center">
      {error ? (
        <>
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <TriangleAlertIcon className="size-5" />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">That did not work</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <Button asChild variant="secondary" className="mt-6">
            <Link href="/">Back to the front page</Link>
          </Button>
        </>
      ) : denied ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight">Nothing was shared</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            You declined, and this app was told so. It holds no credential, and nothing about your
            account reached it — that is what the Cancel button is for.
          </p>
          <Button asChild variant="secondary" className="mt-6">
            <Link href="/">Back to the front page</Link>
          </Button>
        </>
      ) : (
        <>
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Spending the code</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Exchanging the authorization code for an access token and a refresh token, with the
            verifier that never left this tab.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * `useSearchParams` needs a boundary above it, and a callback page that rendered
 * before its query string was readable would be one that refused every sign-in.
 */
export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-6 py-24">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CallbackScreen />
    </Suspense>
  );
}
