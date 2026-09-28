'use client';

import { TriangleAlertIcon } from 'lucide-react';
import { STUDIO_URL } from '@/lib/oauth/config';

/**
 * The warning for a registration that should not exist.
 *
 * A browser app cannot keep a secret. If this build has one, somebody registered
 * it as a confidential client — an easy thing to do, since that is the default on
 * the form and the studio shows a secret to copy — and the secret is now sitting
 * in a bundle that anybody can read. Play still requires PKCE of it, so nothing
 * is *broken*; what is wrong is the belief that a secret is doing work here.
 *
 * Rather than refusing to run, the app runs and says so. That is the more useful
 * demonstration: the mistake is invisible on the consent screen and invisible in
 * the network tab, and the only way to learn it is to be told.
 */
export function SecretWarning() {
  return (
    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="text-sm font-medium">
          This app was registered as a confidential client, and it should not be
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          A client secret is in this browser bundle, which means it is not a secret: anybody who
          opens dev tools can read it. PKCE — which this app uses either way — is what actually
          protects the flow, so the secret adds nothing and teaches the wrong thing.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          The fix is a new app registered as a <strong>public client</strong>: tick &ldquo;This app
          cannot keep a secret&rdquo; at{' '}
          <a
            href={`${STUDIO_URL}/oauth/apps`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-4"
          >
            {STUDIO_URL}/oauth/apps
          </a>
          , put its client id in{' '}
          <span className="font-mono">NEXT_PUBLIC_PLAY_CLIENT_ID</span>, and remove{' '}
          <span className="font-mono">NEXT_PUBLIC_PLAY_CLIENT_SECRET</span>. Whether a client can
          keep a secret is decided when it is registered and cannot be changed afterwards.
        </p>
      </div>
    </div>
  );
}
