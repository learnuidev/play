'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';

/**
 * Whether anybody is signed in.
 *
 * The marketplace renders for both: a visitor reads the catalog, a learner takes
 * a course. Pages that ask the API who the caller is have to know the difference
 * — an anonymous request for "the courses I am in" is a 401, not an empty list —
 * and this is that question answered from the session both apps already carry.
 */
export function useIsSignedIn(): boolean {
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);
  return authStatus === 'authenticated';
}
