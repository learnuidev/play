import { PlainShell } from '@/components/shell/plain-shell';

/**
 * The keys page sits outside any organization.
 *
 * A key can be made for one, but the list is the caller's own: it is their
 * account's credentials, and it is the same page whether they belong to no
 * organization or to six.
 */
export default function ApiKeysLayout({ children }: { children: React.ReactNode }) {
  return <PlainShell crumb="API keys">{children}</PlainShell>;
}
