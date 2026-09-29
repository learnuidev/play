import type { Metadata } from "next";

import { AppsView } from "@/components/apps/apps-view";

export const metadata: Metadata = {
  title: "Frontends · Play Console",
};

export default function AppsPage() {
  return <AppsView />;
}
