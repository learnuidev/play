'use client';

import Link from 'next/link';
import { KeyRoundIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { useSession } from '@/lib/oauth/session';
import { SCOPES, STUDIO_URL } from '@/lib/oauth/config';

/**
 * The gate, for a page that needs a credential.
 *
 * Deliberately not a sign-in form — there is nothing to type. This app has no
 * accounts; the only way in is to be sent to Play to authorize it, which is what
 * the one button does. A page that needs a token and does not have one says so
 * in those terms rather than showing a login box it could not honour.
 */
export function ConnectPrompt({ what }: { what: string }) {
  const { signIn } = useSession();

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border/70 px-6 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        <KeyRoundIcon className="size-5" />
      </div>
      <div className="max-w-md">
        <p className="text-lg font-medium tracking-tight">Connect your Play account first</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {what.charAt(0).toUpperCase() + what.slice(1)} is read with a credential Play issues to
          this app. You will be sent to Play to sign in and approve {SCOPES.length} read-only
          permissions, then brought straight back here.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => void signIn(window.location.pathname)}>
          Connect your Play account
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">What is this app?</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The consent screen is served by Play at{' '}
        <span className="font-mono">{STUDIO_URL}</span>.
      </p>
    </div>
  );
}
