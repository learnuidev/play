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
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Skeleton className="h-80 w-full max-w-[26.25rem] rounded-3xl" />
      </div>
    );
  }

  return <SignIn />;
}

export default function SignInPage() {
  return (
    /**
     * The public bar, and the screen underneath it.
     *
     * A sign-in page with no way off it is a dead end, and the reason somebody is
     * on this one is usually that a link sent them — the front page's button, or
     * the reference asking for a key. So it is the same bar the front page wears,
     * button and all: the page somebody was sent to is the last one that should
     * look like a dead end, and its button is the same one the marketplace keeps
     * on this route.
     *
     * Underneath it in the literal sense: the bar is taken out of the flow and
     * pinned across the top, so the screen below is a whole windowful with the bar
     * drawn over its first line. Left in the flow the bar would take 3rem out of
     * the window, the screen would fill what was left, and the page would be a
     * screenful *plus* a bar — one small scroll for nothing, with the card sitting
     * below the middle of the window it is supposed to be the middle of.
     */
    <div className="relative flex min-h-svh flex-col bg-background">
      <div className="absolute inset-x-0 top-0 z-20">
        <PublicHeader />
      </div>

      {/* `useSearchParams` needs a boundary in the app router. */}
      <Suspense
        fallback={
          <div className="flex min-h-svh items-center justify-center">
            <Skeleton className="h-80 w-full max-w-[26.25rem] rounded-3xl" />
          </div>
        }
      >
        <SignInScreen />
      </Suspense>
    </div>
  );
}
