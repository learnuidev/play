import { PlainShell } from '@/components/shell/plain-shell';

/**
 * Layout for the pages that sit outside any organization — the organization
 * list and the create form. There is no active community here, so they get the
 * plain header rather than the community shell.
 */
export default function OrganizationsLayout({ children }: { children: React.ReactNode }) {
  return <PlainShell crumb="Organizations">{children}</PlainShell>;
}
