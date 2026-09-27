import Link from 'next/link';

/**
 * A slim footer, in the register a front page uses: small, grey, one line.
 *
 * It says where the courses come from and links to the app they are made in,
 * which is the one thing a reader of a marketplace might want next — and it
 * stays out of the way of the catalog above it.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>Courses are published by communities on Play.</p>
        <p className="flex items-center gap-4">
          <Link href="/discover" className="transition-colors hover:text-foreground">
            Discover
          </Link>
          <Link href="/my-courses" className="transition-colors hover:text-foreground">
            My learning
          </Link>
          <Link href="/sign-in" className="transition-colors hover:text-foreground">
            Sign in
          </Link>
        </p>
      </div>
    </footer>
  );
}
