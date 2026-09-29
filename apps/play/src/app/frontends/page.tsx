import type { Metadata } from "next";

import { FrontendsView } from "@/components/frontends/frontends-view";

export const metadata: Metadata = {
  title: "Frontends · Play Console",
};

export default function FrontendsPage() {
  return <FrontendsView />;
}
