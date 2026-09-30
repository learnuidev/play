import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackendView } from "@/components/backends/backend-view";

/**
 * One environment's backend, addressed by stage.
 *
 * `/backends` is the list and this is the environment you open from it, which is
 * why the stage is in the path rather than in a dropdown's state: a link to one
 * environment's output can be sent to somebody, and the back button goes back to
 * the list rather than to whichever environment was selected before.
 *
 * `?tab=` is the one thing the URL carries beyond the name. "The checklist" is
 * where a new environment starts — it is the deploy page's third step that writes
 * the config file — so the button that names a new environment links straight to
 * it, and every tab after that is a link too. **The strip is what reads and writes
 * it** (`useTabParam`, in `components/ui/tabs.tsx`), so this page takes no
 * `tab` prop at all: a tab passed from here would be the value the page first
 * rendered with, and the one thing it could never do is change when somebody
 * clicked a tab.
 *
 * A name that could never be a stage is a 404. A stage that does not exist yet is
 * emphatically **not**: that page is the one this console exists to draw, and its
 * Deployments tab is how the stage stops not existing.
 */

const STAGE = /^[a-z0-9][a-z0-9-]{0,30}$/;

type Props = { params: { stage: string } };

export function generateMetadata({ params }: Props): Metadata {
  return { title: `${params.stage} · Backends · Play Console` };
}

export default function BackendPage({ params }: Props) {
  if (!STAGE.test(params.stage)) notFound();

  return <BackendView key={params.stage} stage={params.stage} />;
}
