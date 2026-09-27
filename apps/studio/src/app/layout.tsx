import type { Metadata } from "next";

// @ts-ignore
import "./globals.css";
import { AppProviders } from "@play/auth";

export const metadata: Metadata = {
  title: "Play Studio",
  description: "Where creators build courses: videos, spaces, lessons and the people taking them",
};

/**
 * The studio's frame, such as it is.
 *
 * There used to be a sign-in gate here, wrapping the whole tree, because the
 * studio was a place you were signed in to and nothing in it was public. Two
 * things are public now — the front page, which is how anybody decides to sign
 * up, and the API reference, which is a document somebody reads *before* they
 * have an account — so the gate moved to the places that need it. Each of the
 * signed-in sections wraps itself in `AuthGate`: the organization shell, the
 * spaces and invitations lists that live outside one, and the keys screen.
 *
 * The rule that keeps that honest is the same one the marketplace follows: a
 * layout that renders a section decides who may see the section, and a page
 * added under one of them inherits the answer rather than having to remember it.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
