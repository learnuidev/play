import type { Metadata } from 'next';

// @ts-ignore
import './globals.css';
import { AppProviders } from '@play/auth';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Play Marketplace',
  description: 'Find a course, register for it, and take its lessons',
};

/**
 * The marketplace's frame: a top bar and a column of content.
 *
 * Note what is *not* here: the sign-in gate. The studio is a place you are signed
 * in to; the marketplace is a front page, and a front page behind a login is one
 * nobody reads. The pages that need an account ask for one themselves, at the
 * moment somebody tries to register for something.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <AppProviders>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
