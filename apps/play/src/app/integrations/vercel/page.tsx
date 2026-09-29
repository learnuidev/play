import type { Metadata } from "next";

import { VercelView } from "@/components/integrations/vercel-view";

export const metadata: Metadata = {
  title: "Vercel · Play Console",
};

export default function VercelPage() {
  return <VercelView />;
}
