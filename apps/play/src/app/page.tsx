import type { Metadata } from "next";

import { DeployView } from "@/components/deploy/deploy-view";

export const metadata: Metadata = {
  title: "Deploy · Play Console",
};

export default function DeployPage() {
  return <DeployView />;
}
