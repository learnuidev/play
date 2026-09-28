import { AuthGate } from '@play/auth';
import { PlainShell } from '@/components/shell/plain-shell';

/**
 * Connected apps: what this account has let in.
 *
 * The other side of the consent screen, and the reason the consent screen is
 * worth having: a permission somebody granted in passing, on their way into
 * somebody else's app, has to be findable later and takeable back. It is the
 * person's own list — an app's author cannot see who connected it, and cannot
 * see this page at all.
 *
 * Behind the gate, like the keys and the apps beside it.
 */
export default function OAuthConnectionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlainShell crumb="Connected apps">{children}</PlainShell>
    </AuthGate>
  );
}
