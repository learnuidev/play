import type { Metadata } from "next";

import { AwsView } from "@/components/integrations/aws-view";

export const metadata: Metadata = {
  title: "AWS · Play Console",
};

export default function AwsPage() {
  return <AwsView />;
}
