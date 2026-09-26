import { cn } from '@/lib/utils';
import { SPACE_COLORS } from '@/types';

/**
 * The colour a space is drawn in: its own if it was given one, otherwise one
 * derived from its id.
 *
 * Deriving rather than defaulting matters — a wall of spaces all in the same
 * grey tells you nothing, while a stable colour per id lets you recognise a
 * space at a glance in the list, the sidebar, and its own page. Stable because
 * it hashes the id, not the title, which can be edited.
 */
export function spaceAccentColor(space: { spaceId: string; color?: string }): string {
  if (space.color) return space.color;

  let hash = 0;
  for (let i = 0; i < space.spaceId.length; i += 1) {
    hash = (hash * 31 + space.spaceId.charCodeAt(i)) % 1_000_003;
  }
  return SPACE_COLORS[hash % SPACE_COLORS.length];
}

const SIZES = {
  sm: 'size-6 rounded-md text-[10px]',
  md: 'size-9 rounded-lg text-sm',
  lg: 'size-12 rounded-xl text-lg',
} as const;

/** Square tile carrying a space's initial in its accent colour. */
export function SpaceAvatar({
  space,
  size = 'md',
  className,
}: {
  space: { spaceId: string; title: string; color?: string };
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initial = space.title.trim()[0]?.toUpperCase() ?? '?';

  return (
    <div
      aria-hidden
      style={{ backgroundColor: spaceAccentColor(space) }}
      className={cn(
        'flex shrink-0 select-none items-center justify-center font-semibold text-white',
        SIZES[size],
        className,
      )}
    >
      {initial}
    </div>
  );
}
