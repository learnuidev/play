import { cn } from '@/lib/utils';

/**
 * Avatar colours are picked from a fixed palette by hashing the organization id,
 * so an organization keeps the same colour everywhere it appears (rail, sidebar
 * header) without storing one.
 */
const PALETTE = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
] as const;

function hash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function orgColorClass(orgId: string): string {
  return PALETTE[hash(orgId) % PALETTE.length];
}

export function orgInitial(name: string): string {
  const first = name.trim()[0];
  return first ? first.toUpperCase() : '?';
}

const SIZES = {
  sm: 'size-7 rounded-lg text-xs',
  md: 'size-10 rounded-xl text-sm',
} as const;

export function OrgAvatar({
  orgId,
  name,
  size = 'md',
  className,
}: {
  orgId: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center font-semibold text-white',
        SIZES[size],
        orgColorClass(orgId),
        className,
      )}
    >
      {orgInitial(name)}
    </div>
  );
}
