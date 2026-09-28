import { AuthGate } from '@play/auth';
import { PlainShell } from '@/components/shell/plain-shell';

/**
 * The developer pages sit outside any organization.
 *
 * An OAuth app belongs to the *person* who registered it, exactly as a key
 * does: it is their client, it acts as whoever authorizes it, and it is the same
 * screen whether they belong to no organization or to six. Where a key is one
 * credential that acts as one person, an app is the newer, narrower shape of the
 * same idea — a client that a person consents to, scope by scope.
 *
 * Behind the gate, like the keys screen beside it, and for a sharper version of
 * the same reason: one of these screens registers clients and mints secrets, and
 * the other shows what has been let into the account.
 */
export default function OAuthAppsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlainShell crumb="OAuth apps">{children}</PlainShell>
    </AuthGate>
  );
}
