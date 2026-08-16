import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Play Studio",
  description: "Full-stack AWS video streaming service",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
