'use client';

import { OAuthCallback } from '@play/auth';

/**
 * Where Cognito sends the browser back to.
 *
 * `/` is the marketplace's front page: whatever the reader was doing before they
 * signed in, the catalog is what they came for, and the page they were on is one
 * click back.
 */
export default function AuthCallbackPage() {
  return <OAuthCallback redirectTo="/" />;
}
