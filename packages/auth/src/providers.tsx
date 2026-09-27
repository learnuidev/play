'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { ThemeProvider } from 'next-themes';
import { usePathname } from 'next/navigation';
import { QueryProvider } from '@auth/components/query-provider';
import { isAuthConfigured, isGoogleSignInEnabled, oauthCallbackPath } from '@auth/lib/amplify';
import { Toaster } from '@ui/components/ui/sonner';
import { TooltipProvider } from '@ui/components/ui/tooltip';

/** The identity providers the Authenticator knows how to draw a button for. */
type AuthenticatorSocialProviders = React.ComponentProps<typeof Authenticator>['socialProviders'];

/**
 * Everything a page needs to exist, without deciding who may see it.
 *
 * This used to be the studio's sign-in gate as well, which is why the split
 * matters: the marketplace is browsable by somebody who has not signed in — its
 * catalog is public — and a provider stack that insists on an authenticated user
 * cannot render a landing page at all. So the gate became its own component
 * (`AuthGate`) and this one only wires up theme, query cache, tooltips, the
 * Amplify session and toasts.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  if (!isAuthConfigured) {
    return <ConfigurationRequired />;
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <QueryProvider>
        <TooltipProvider>
          <Authenticator.Provider>{children}</Authenticator.Provider>
          <Toaster />
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

/**
 * The sign-in screen: Amplify's Authenticator, with whichever identity providers
 * this deployment has.
 *
 * Every app signs in through this rather than rendering `Authenticator` itself.
 * A deployment with Google configured offers it — `socialProviders` is what puts
 * the button on the screen, and an app that forgot to pass it would silently
 * offer passwords only, which looks like a deployment problem rather than a
 * missing prop. With children it is still the gate (they render once signed in);
 * without them it is the sign-in page itself.
 */
export function SignIn({ children }: { children?: React.ReactNode }) {
  // Typed from the Authenticator's own props rather than a named type: the
  // providers it accepts are a closed set, and `['google']` on its own widens to
  // `string[]` — which the component refuses.
  const socialProviders: AuthenticatorSocialProviders = isGoogleSignInEnabled
    ? ['google']
    : undefined;

  if (!children) {
    return <Authenticator socialProviders={socialProviders} />;
  }

  return <Authenticator socialProviders={socialProviders}>{children}</Authenticator>;
}

/**
 * The sign-in wall: everything inside it is for signed-in people alone.
 *
 * The OAuth callback route must not render the sign-in screen — it is the
 * handshake that *creates* the session, so gating it would ask somebody to sign
 * in before they can finish signing in. It passes straight through.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === oauthCallbackPath) {
    return <>{children}</>;
  }

  return <SignIn>{children}</SignIn>;
}

/** What an app shows when it has no API or user pool to talk to. */
function ConfigurationRequired() {
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
