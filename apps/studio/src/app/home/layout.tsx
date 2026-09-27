import { AuthGate } from '@play/auth';

/**
 * Where the studio's signed-in landing lives.
 *
 * There is nothing to *see* here — the page reads two lists and forwards you —
 * so it gets the gate and nothing else: no header, no rail, no measure. A
 * skeleton for a redirect is the whole of its chrome.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
