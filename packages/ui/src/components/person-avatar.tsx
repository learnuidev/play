import { UserRoundIcon } from 'lucide-react';
import { cn } from '@ui/lib/utils';

/**
 * A person, as a circle.
 *
 * The repo already drew this three times — initials in the studio's member rows,
 * a tinted monogram on the marketplace's front page, a square initial for a
 * course — and each of them was a stand-in for a photo nobody had. Now that a
 * person can upload one, the circle has to make a decision the initials never
 * did: draw the face when there is one, and something honest when there is not.
 *
 * A person with no photo is drawn as a person, not as letters. Initials are a
 * decent guess for a *name*, but they are also what a broken image looks like,
 * and a course page that shows `AR` in a grey circle to somebody who has not set
 * a photo is telling them nothing they could not already read beside it. The
 * silhouette says "there is a person here who has not uploaded a picture", which
 * is exactly true.
 *
 * It is markup rather than a photograph, so `<img>` with the linter turned off
 * and no `next/image`: the URL is a short-lived signed CloudFront URL that Next's
 * optimizer would have to be taught about, fetch, and then cache past its own
 * expiry.
 */
const SIZES = {
  sm: 'size-6',
  md: 'size-9',
  lg: 'size-12',
  xl: 'size-24',
} as const;

const ICON_SIZES = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
  xl: 'size-10',
} as const;

export function PersonAvatar({
  name,
  photoUrl,
  size = 'md',
  className,
}: {
  /** Used for the accessible label, so a screen reader hears who this is. */
  name: string;
  photoUrl?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted/60 text-muted-foreground',
        SIZES[size],
        className,
      )}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" />
      ) : (
        <UserRoundIcon className={ICON_SIZES[size]} aria-hidden />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
