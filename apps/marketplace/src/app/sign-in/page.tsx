'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { internalPath, rememberAfterSignIn, SignIn, useIsSignedIn } from '@play/auth';
import { Skeleton } from '@ui/components/ui/skeleton';

/**
 * Signing in, and being sent back to what you were doing.
 *
 * Registering for a course is the moment the marketplace asks who you are, so
 * the course page sends the reader here with `?next=` naming it. Without that,
 * signing in would drop them on the front page to find the course again.
 *
 * `SignIn` is the shared screen, so this page offers whatever the deployment
 * offers — a password, or Google — without listing the providers itself.
 *
 * What it does not bring is the room: the screen is a windowful on its own, and
 * the frame around it — see `SiteChrome`, which pins its bar over a screenful on
 * this route rather than taking a slice of the window out of it — is what lets it
 * be one while somebody who has not decided to sign in yet still has the bar.
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
  const next = internalPath(search.get('next')) ?? '/my-courses';

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
     * Nothing of this page's own: the screen is a windowful, and the frame around
     * it — `SiteChrome`, which pins its bar over a screenful on this route — is
     * what lets it be one without the bar taking a slice of the window first or
     * the card ending up below the middle of the window it is the middle of.
     * Centering, height and the canvas are the shared screen's business, which is
     * why there is nothing here to say about any of them.
     */
    <>
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
    </>
  );
}
