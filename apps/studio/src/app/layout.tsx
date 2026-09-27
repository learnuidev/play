import type { Metadata } from "next";

// @ts-ignore
import "./globals.css";
import { AppProviders, AuthGate } from "@play/auth";

export const metadata: Metadata = {
  title: "Play Studio",
  description: "Where creators build courses: videos, spaces, lessons and the people taking them",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <AppProviders>
          {/* The studio is a place you are signed in to: nothing here is public. */}
          <AuthGate>{children}</AuthGate>
        </AppProviders>
      </body>
    </html>
  );
}
