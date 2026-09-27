import { cn } from '@/lib/utils';

function orgInitial(name: string): string {
  const first = name.trim()[0];
  return first ? first.toUpperCase() : '?';
}

const SIZES = {
  sm: 'size-6 rounded-md text-[10px]',
  md: 'size-8 rounded-lg text-xs',
} as const;

/**
 * Organization tile for the rail and the community header.
 *
 * Monochrome on purpose: `--primary` is near-black in light mode and near-white
 * in dark mode, so every organization renders as a solid tile that follows the
 * theme, and no organization out-shouts another.
 */
export function OrgAvatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center bg-primary font-semibold text-primary-foreground',
        SIZES[size],
        className,
      )}
    >
      {orgInitial(name)}
    </div>
  );
}
