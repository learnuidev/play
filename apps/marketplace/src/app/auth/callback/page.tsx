'use client';

import { OAuthCallback } from '@play/auth';

/**
 * Where Cognito sends the browser back to.
 *
 * Discover is where the courses are: whatever the reader was doing before they
 * signed in, a course is what they came for, and the page they were on is one
 * click back. It used to be `/`, which is the front page now — sending somebody
 * who has just signed in back to a marketing page would be asking them to start
 * over.
 */
export default function AuthCallbackPage() {
  return <OAuthCallback redirectTo="/discover" />;
}
