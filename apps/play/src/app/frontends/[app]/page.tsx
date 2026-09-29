import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FrontendView } from "@/components/frontends/frontend-view";
import { frontendOf } from "@/lib/frontends";

/**
 * One frontend, addressed by name.
 *
 * `/frontends` is the list and this is the thing you open from it, which is why
 * the name is in the path rather than in a dropdown's state: a link to a
 * frontend's output can be sent to somebody, and the back button goes back to
 * the list rather than to whichever frontend was selected before.
 *
 * A slug nobody starts is a 404 rather than an empty page — the set is three
 * names long and the console knows all of them.
 */

type Params = { params: { app: string } };

export function generateMetadata({ params }: Params): Metadata {
  const frontend = frontendOf(params.app);
  return { title: `${frontend?.label ?? "Frontends"} · Play Console` };
}

export default function FrontendPage({ params }: Params) {
  const frontend = frontendOf(params.app);
  if (!frontend) notFound();

  return <FrontendView app={frontend.value} />;
}
