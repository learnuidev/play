import { AuthGate } from '@play/auth';
import { PlainShell } from '@/components/shell/plain-shell';

/**
 * The keys page sits outside any organization.
 *
 * A key can be made for one, but the list is the caller's own: it is their
 * account's credentials, and it is the same page whether they belong to no
 * organization or to six.
 *
 * It is one of the few pages behind the gate now that the front page and the API
 * reference are public, and it is the sharpest example of why the gate is worth
 * having: this is the screen that mints credentials.
 */
export default function ApiKeysLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlainShell crumb="API keys">{children}</PlainShell>
    </AuthGate>
  );
}
