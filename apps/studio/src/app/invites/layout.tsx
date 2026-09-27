import { PlainShell } from '@/components/shell/plain-shell';

export default function InvitationsLayout({ children }: { children: React.ReactNode }) {
  return <PlainShell crumb="Invites">{children}</PlainShell>;
}
