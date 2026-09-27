import { AuthGate } from '@play/auth';
import { PlainShell } from '@/components/shell/plain-shell';

/**
 * Layout for the pages that sit outside any organization — the organization
 * list and the create form. There is no active community here, so they get the
 * plain header rather than the community shell.
 *
 * The header is inside the gate: somebody who is not signed in sees the sign-in
 * screen and nothing else, rather than a bar of links to pages they cannot open.
 */
export default function OrganizationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlainShell crumb="Organizations">{children}</PlainShell>
    </AuthGate>
  );
}
