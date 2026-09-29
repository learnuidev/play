import type { Metadata } from "next";

import { ConsoleShell } from "@/components/console/shell";
import { ShellProvider } from "@/components/console/state";

import "./globals.css";

/**
 * The console's document.
 *
 * `dark` is on `<html>` before anything renders: a console is read in a room
 * with a transcript in it, and a page that flashes white first is a page that
 * hurts at the hour somebody is most likely to be looking at it. The stored
 * preference is applied by a two-line script rather than by waiting for React,
 * because waiting for React is exactly the flash this avoids.
 */

export const metadata: Metadata = {
  title: "Play Console",
  description:
    "Deploy the Play backend to an environment, and run the studio, the marketplace and the demo against it.",
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("play-console:theme");document.documentElement.classList.toggle("dark",t!=="light")}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ShellProvider>
          <ConsoleShell>{children}</ConsoleShell>
        </ShellProvider>
      </body>
    </html>
  );
}
