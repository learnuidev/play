'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Authenticator } from '@aws-amplify/ui-react';
import { useIsSignedIn } from '@play/auth';
import { Skeleton } from '@ui/components/ui/skeleton';

/**
 * Signing in, and being sent back to what you were doing.
 *
 * Registering for a course is the moment the marketplace asks who you are, so
 * the course page sends the reader here with `?next=` naming it. Without that,
 * signing in would drop them on the front page to find the course again.
 *
 * The Authenticator is Amplify's, unchanged — the same one the studio signs in
 * with, against the same user pool, because a learner and an author are the same
 * person with different intentions.
 */
function SignIn() {
  const router = useRouter();
  const search = useSearchParams();
  const signedIn = useIsSignedIn();

  /**
   * Only a path on this site, never a full URL: a `next` anybody can write is a
   * redirect anybody can aim, and an open redirect off a sign-in page is how a
   * phishing link borrows this app's name.
   */
  const requested = search.get('next') ?? '';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/my-courses';

  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [next, router, signedIn]);

  // Rendered only once the session is known, so somebody who is already signed
  // in never sees the form flash before being redirected.
  if (signedIn) {
    return <Skeleton className="h-80 w-full max-w-sm rounded-2xl" />;
  }

  return <Authenticator />;
}

export default function SignInPage() {
  return (
    <div className="flex min-h-[70svh] items-center justify-center">
      <div className="w-full max-w-sm">
        {/* `useSearchParams` needs a boundary in the app router. */}
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-2xl" />}>
          <SignIn />
        </Suspense>
      </div>
    </div>
  );
}
