import { cn } from '@ui/lib/utils';

/**
 * An app's mark, as a tile.
 *
 * The square version of a person's circle, and for the same reason: a consent
 * screen is a decision about somebody else's software, and it has to show what
 * that software looks like. An app that has uploaded a logo gets it; one that
 * has not gets its initial, which is the honest fallback for a *name* — unlike a
 * person's photo, where initials are also what a broken image looks like.
 *
 * `<img>` with the linter turned off and no `next/image`, as `PersonAvatar` does
 * for a signed URL: an app's logo is an arbitrary third-party URL the Next
 * optimizer would have to fetch and cache on our behalf, which is a request this
 * service makes to a host an app's author chose. It is drawn at a known size, and
 * the browser is perfectly capable of that.
 */
const SIZES = {
  sm: 'size-8 rounded-lg text-sm',
  md: 'size-12 rounded-xl text-lg',
  lg: 'size-16 rounded-2xl text-2xl',
} as const;

function initialOf(name: string): string {
  const first = name.trim()[0];
  return first ? first.toUpperCase() : '?';
}

export function AppMark({
  name,
  logoUrl,
  size = 'md',
  className,
}: {
  name: string;
  logoUrl?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 select-none items-center justify-center overflow-hidden border border-border/60 bg-primary font-semibold text-primary-foreground',
        SIZES[size],
        className,
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initialOf(name)}</span>
      )}
    </span>
  );
}
