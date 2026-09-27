'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { internalPath, rememberAfterSignIn, SignIn, useIsSignedIn } from '@play/auth';
import { Skeleton } from '@ui/components/ui/skeleton';
import { PublicHeader } from '@/components/public-header';

/**
 * Signing in, with a way back to whatever sent you here.
 *
 * The studio has a gate as well as this page, and they are not duplicates: the
 * gate draws the same screen *over* a page you tried to open, which is what
 * somebody following a link to their keys or their community gets. This page is
 * for the places that point at signing in rather than at a screen — the front
 * page's own button, and the API reference, where a reader who wants to mint a
 * key is sent here with `?next=/docs` and comes back to the section they were
 * reading.
 */
function SignInScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const signedIn = useIsSignedIn();

  /**
   * Only a path on this site, never a full URL: a `next` anybody can write is a
   * redirect anybody can aim, and an open redirect off a sign-in page is how a
   * phishing link borrows this app's name.
   */
  const next = internalPath(search.get('next')) ?? '/home';

  /**
   * Noted before anything else, because signing in with Google leaves this page
   * entirely: the browser goes to the Cognito Hosted UI and comes back to
   * `/auth/callback`, which has no `?next=` to read. The note is what carries it
   * across.
   */
  useEffect(() => {
    rememberAfterSignIn(next);
  }, [next]);

  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [next, router, signedIn]);

  // Rendered only once the session is known, so somebody who is already signed
  // in never sees the form flash before being redirected.
  if (signedIn) {
    return <Skeleton className="h-80 w-full max-w-sm rounded-3xl" />;
  }

  return <SignIn />;
}

export default function SignInPage() {
  return (
    /**
     * The public bar, then the screen.
     *
     * A sign-in page with no way off it is a dead end, and the reason somebody is
     * on this one is usually that a link sent them — the front page's button, or
     * the reference asking for a key. The bar's own button is left off
     * (`showEntry={false}`): it would point at the page it is sitting above.
     */
    <div className="flex min-h-svh flex-col bg-background">
      <PublicHeader showEntry={false} />

      {/*
       * `flex-1` and the custom property are one decision: the screen's frame is a
       * windowful unless the app says otherwise, and here the bar above it has
       * already taken some of the window. `--sign-in-min-height: 0` tells the
       * shared screen not to assume the whole viewport, and the centering below is
       * this element's job instead — see the note in the shared stylesheet.
       */}
      <div
        className="flex flex-1 items-center justify-center"
        style={{ '--sign-in-min-height': '0px' } as React.CSSProperties}
      >
        {/* `useSearchParams` needs a boundary in the app router. */}
        <Suspense
          fallback={
            <div className="w-full max-w-sm">
              <Skeleton className="h-80 w-full rounded-3xl" />
            </div>
          }
        >
          <SignInScreen />
        </Suspense>
      </div>
    </div>
  );
}
