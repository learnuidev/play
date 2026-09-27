'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';

/**
 * Who is looking.
 *
 * A handful of things are the caller's own — their loops, the likes on them, the
 * progress they have made — and the API says so with a Cognito `sub`. This is
 * the same `sub` on this side, so a list can tell somebody's own rows from
 * everyone else's without asking the server which ones are theirs.
 *
 * `userId` rather than `username`: in Amplify v6 the former is the `sub` every
 * record is keyed by, and the latter is the sign-in name, which can change.
 */
export function useViewerId(): string | undefined {
  const { user } = useAuthenticator((context) => [context.user]);
  return user?.userId;
}
