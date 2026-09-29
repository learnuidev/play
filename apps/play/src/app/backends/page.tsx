import type { Metadata } from "next";

import { BackendsView } from "@/components/backends/backends-view";

export const metadata: Metadata = {
  title: "Backends · Play Console",
};

export default function BackendsPage() {
  return <BackendsView />;
}
