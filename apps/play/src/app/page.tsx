import { redirect } from "next/navigation";

/**
 * The root is the Backends page.
 *
 * A backend in an environment is the subject of this console — the frontends and
 * the integrations are both downstream of it — so `/` goes there rather than to
 * a landing page that would only be a menu.
 */
export default function RootPage() {
  redirect("/backends");
}
