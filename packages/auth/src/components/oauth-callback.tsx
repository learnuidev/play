'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { Hub } from 'aws-amplify/utils';
import { Loader2Icon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui/card';

/**
 * Landing page for OAuth sign-in (Google), for whichever app was redirected to.
 *
 * The redirect back from the Cognito Hosted UI carries an authorization code.
 * Amplify's OAuth listener — registered in `../lib/amplify`, which the app-wide
 * providers import — exchanges that code for tokens and reports the result. This
 * only reflects that outcome: it waits for the session, then hands the reader on.
 *
 * Where it hands them to is the app's business, so it is a prop: the studio
 * opens the community they belong to, and the marketplace opens its front page.
 * Both apps register this same route at `/auth/callback` — the path Cognito was
 * told about — and both render this component there.
 */

/** If nothing happens after this long, stop showing an indefinite spinner. */
const STUCK_TIMEOUT_MS = 8000;

function errorMessage(data: unknown): string {
  const error = (data as { error?: { message?: string } } | undefined)?.error;
  return error?.message ?? 'Sign-in could not be completed. Please try again.';
}

export function OAuthCallback({ redirectTo = '/' }: { redirectTo?: string }) {
  const router = useRouter();
  const { authStatus } = useAuthenticator();
  const [error, setError] = useState<string | null>(null);
  const [isStuck, setIsStuck] = useState(false);

  // Once the tokens are stored, the session flips to authenticated, and the
  // reader is handed to wherever this app considers "where you were going".
  useEffect(() => {
    if (authStatus === 'authenticated') {
      router.replace(redirectTo);
    }
  }, [authStatus, redirectTo, router]);

  useEffect(() => {
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') {
        router.replace(redirectTo);
      } else if (payload.event === 'signInWithRedirect_failure') {
        setError(errorMessage(payload.data));
      }
    });

    return unsubscribe;
  }, [redirectTo, router]);

  // Cognito redirects back with ?error=... when the provider rejects the sign-in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error_description') ?? params.get('error');
    if (oauthError) {
      setError(oauthError);
    }
  }, []);

  useEffect(() => {
    if (authStatus === 'authenticated' || error) {
      return;
    }

    const timer = window.setTimeout(() => setIsStuck(true), STUCK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [authStatus, error]);

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{error ? 'Sign-in failed' : 'Signing you in'}</CardTitle>
          <CardDescription>
            {error
              ? 'We could not complete the sign-in with Google.'
              : 'Finishing the sign-in with your identity provider…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <>
              <p className="text-sm text-destructive">{error}</p>
              <Button asChild>
                <Link href="/">Back to sign in</Link>
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                <span>This should only take a moment.</span>
              </div>
              {isStuck && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Still waiting. You can return to the sign-in page and try again.
                  </p>
                  <Button asChild variant="outline">
                    <Link href="/">Back to sign in</Link>
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
