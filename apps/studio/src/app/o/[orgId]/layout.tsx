import { AuthGate } from '@play/auth';
import { AppShell } from '@/components/shell/app-shell';

/**
 * An organization's pages, and the sign-in wall in front of them.
 *
 * This is where the gate lands for everything under `/o`: the community shell,
 * its courses, its members and its settings. Somebody who is not signed in gets
 * the sign-in screen *instead of* the shell — the wall is outside it rather than
 * drawn inside it, so there is no rail of links to places they cannot go.
 */
export default function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { orgId: string };
}) {
  return (
    <AuthGate>
      <AppShell orgId={params.orgId}>{children}</AppShell>
    </AuthGate>
  );
}
