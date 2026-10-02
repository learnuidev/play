import { redirect } from 'next/navigation';

/**
 * `/account` is the profile, which is the one of the three that is about the
 * person rather than about their money.
 *
 * A redirect rather than a fourth screen: a landing page whose whole content is
 * three links would be a page somebody has to read before they can read
 * anything, and the tabs across the top of every account screen already are
 * those three links.
 */
export default function AccountPage() {
  redirect('/account/profile');
}
