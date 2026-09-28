import { AuthGate } from '@play/auth';
import { PlainShell } from '@/components/shell/plain-shell';

/**
 * The profile sits outside any organization, for the same reason the keys do:
 * it is about the person rather than about anything they belong to. An
 * instructor teaches a course in one community and takes one in the next, and
 * what the marketplace says about them is the same on both.
 */
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlainShell crumb="Profile">{children}</PlainShell>
    </AuthGate>
  );
}
