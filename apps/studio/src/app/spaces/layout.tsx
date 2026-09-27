import { AuthGate } from '@play/auth';
import { PlainShell } from '@/components/shell/plain-shell';

/**
 * Layout for the courses somebody has access to, wherever they are.
 *
 * This sits outside any organization on purpose: a course can be taken by a
 * person who belongs to no organization at all, and for them there is no
 * community shell to put it in. A wall of cards rather than a page of prose, so
 * it gets the wider column.
 */
export default function SpacesLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlainShell crumb="Spaces" width="wide">
        {children}
      </PlainShell>
    </AuthGate>
  );
}
