import type { Metadata } from 'next';

// @ts-ignore
import './globals.css';
import { Toaster } from '@ui/components/ui/sonner';
import { TooltipProvider } from '@ui/components/ui/tooltip';
import { SessionProvider } from '@/lib/oauth/session';
import { SiteChrome } from '@/components/site-chrome';

export const metadata: Metadata = {
  title: 'Fieldnotes — a classroom built on the Play API',
  description:
    'A demo third-party app: it signs people in with Play over OAuth, then reads courses and lessons with the token it is given.',
};

/**
 * The demo's frame.
 *
 * Three providers and no gate. `SessionProvider` is this app's own — it holds an
 * OAuth token rather than a Play session, and it is the only thing here that
 * knows what a token is. `TooltipProvider` is the shared one, because the
 * transcript and the player are shared components and expect it.
 *
 * There is no `@play/auth` in this tree at all, which is the clearest way to say
 * what the app is: it never signs anybody in to Play. It sends them to Play to
 * *authorize* it, and comes back with a credential.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <SessionProvider>
          <TooltipProvider>
            <SiteChrome>{children}</SiteChrome>
            <Toaster />
          </TooltipProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
