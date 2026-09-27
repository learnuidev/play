'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';

/**
 * What the session is doing, in three states rather than two.
 *
 * `configuring` is the one that matters and the one a boolean hides: Amplify
 * restores a session from storage after the page is alive, so on every reload
 * there is a moment where nobody is signed in *yet*. Collapsing that into
 * "signed out" makes a signed-in reader watch the app tell them to sign in — a
 * flash of the wrong answer, which is worse than a moment of no answer. A page
 * that can wait should ask this instead.
 */
export type AuthStatus = 'configuring' | 'authenticated' | 'unauthenticated';

/** The session's state, for pages that have something to do while it loads. */
export function useAuthStatus(): AuthStatus {
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);
  return authStatus;
}

/**
 * Whether anybody is signed in.
 *
 * The marketplace renders for both: a visitor reads the catalog, a learner takes
 * a course. Pages that ask the API who the caller is have to know the difference
 * — an anonymous request for "the courses I am in" is a 401, not an empty list —
 * and this is that question answered from the session both apps already carry.
 *
 * False while the session is still being restored, so a caller that would act on
 * it differently from "not signed in" should ask `useAuthStatus` first.
 */
export function useIsSignedIn(): boolean {
  return useAuthStatus() === 'authenticated';
}
