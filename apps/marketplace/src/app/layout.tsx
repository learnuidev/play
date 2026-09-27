import type { Metadata } from 'next';

// @ts-ignore
import './globals.css';
import { AppProviders } from '@play/auth';
import { SiteChrome } from '@/components/site-chrome';

export const metadata: Metadata = {
  title: 'Play Marketplace',
  description: 'Find a course, register for it, and take its lessons',
};

/**
 * The marketplace's frame, such as it is.
 *
 * Note what is *not* here: the sign-in gate, and the chrome itself. The studio is
 * a place you are signed in to; the marketplace is a front page, and a front page
 * behind a login is one nobody reads — so the pages that need an account ask for
 * one themselves. The bar and the reading measure are `SiteChrome`'s business
 * rather than this layout's, because a lesson wants neither of them.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <AppProviders>
          <SiteChrome>{children}</SiteChrome>
        </AppProviders>
      </body>
    </html>
  );
}
