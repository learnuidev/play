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
 * What it does bring is the room: the screen's own frame is a windowful unless
 * the app tells it otherwise, and this app keeps its header and footer around
 * somebody who has not decided to sign in yet. So the page hands it what is left
 * of the window instead — see `--sign-in-min-height` in the shared stylesheet.
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
      <Skeleton className="h-80 w-full max-w-sm rounded-3xl" />
    );
  }

  return <SignIn />;
}

export default function SignInPage() {
  return (
    /**
     * `h-full` rather than a viewport of its own: the frame has already taken the
     * header and the footer out of the window, so what is left is this element's
     * height, and the screen centers itself inside it. The custom property is the
     * other half of that — it tells the shared screen not to assume it has the
     * whole viewport, because here it does not.
     */
    <div
      className="flex h-full items-center justify-center"
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
  );
}
