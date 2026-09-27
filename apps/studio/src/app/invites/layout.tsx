import { AuthGate } from '@play/auth';
import { PlainShell } from '@/components/shell/plain-shell';

/** What has been offered to you, which is nothing anybody else may read. */
export default function InvitationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlainShell crumb="Invites">{children}</PlainShell>
    </AuthGate>
  );
}
