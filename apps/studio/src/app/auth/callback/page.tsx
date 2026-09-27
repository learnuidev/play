'use client';

import { OAuthCallback } from '@play/auth';

/**
 * Where Cognito sends the browser back to.
 *
 * `/home` is the studio's own resolution: the first community you belong to, the
 * courses you are taking, or the form for creating one. It is no longer `/`,
 * which is the front page — a redirect off the sign-in handshake should land
 * somebody inside the app, not on the page that explains it.
 *
 * A sign-in that started on a specific screen still wins: `OAuthCallback` reads
 * the note the sign-in page left behind and goes there instead.
 */
export default function AuthCallbackPage() {
  return <OAuthCallback redirectTo="/home" />;
}
