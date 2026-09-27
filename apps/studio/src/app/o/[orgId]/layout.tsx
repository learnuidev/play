import { AppShell } from '@/components/shell/app-shell';

export default function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { orgId: string };
}) {
  return <AppShell orgId={params.orgId}>{children}</AppShell>;
}
