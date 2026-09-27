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
    return <Skeleton className="h-80 w-full rounded-2xl" />;
  }

  return <SignIn />;
}

export default function SignInPage() {
  return (
    <div className="flex min-h-[70svh] items-center justify-center">
      <div className="w-full max-w-sm">
        {/* `useSearchParams` needs a boundary in the app router. */}
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-2xl" />}>
          <SignInScreen />
        </Suspense>
      </div>
    </div>
  );
}
