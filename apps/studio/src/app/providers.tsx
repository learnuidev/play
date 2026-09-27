'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { ThemeProvider } from 'next-themes';
import { usePathname } from 'next/navigation';
import { isAuthConfigured, isGoogleSignInEnabled, oauthCallbackPath } from '@/lib/amplify';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { QueryProvider } from '@/components/query-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (!isAuthConfigured) {
    return (
      <div className="config-missing">
        <h1>Configuration required</h1>
        <p>
          Set the following environment variables in <code>.env.local</code> and restart the dev
          server:
        </p>
        <ul>
          <li>
            <code>NEXT_PUBLIC_API_URL</code>
          </li>
          <li>
            <code>NEXT_PUBLIC_COGNITO_USER_POOL_ID</code>
          </li>
          <li>
            <code>NEXT_PUBLIC_COGNITO_CLIENT_ID</code>
          </li>
        </ul>
        <p>
          Google sign-in additionally needs <code>NEXT_PUBLIC_COGNITO_DOMAIN</code> and{' '}
          <code>NEXT_PUBLIC_GOOGLE_AUTH_ENABLED</code> (both come from{' '}
          <code>npm run get-env</code>).
        </p>
      </div>
    );
  }

  // The OAuth callback route must not render the sign-in screen: it completes
  // the redirect handshake and then sends the user on to the studio. It only
  // needs the state provider, not the Authenticator UI gate.
  const isOAuthCallback = pathname === oauthCallbackPath;

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <QueryProvider>
        <TooltipProvider>
          <Authenticator.Provider>
            {isOAuthCallback ? (
              children
            ) : (
              <Authenticator socialProviders={isGoogleSignInEnabled ? ['google'] : undefined}>
                {children}
              </Authenticator>
            )}
          </Authenticator.Provider>
          <Toaster />
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
