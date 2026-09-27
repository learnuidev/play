'use client';

import Link from 'next/link';
import { CalendarClockIcon, CirclePlayIcon } from 'lucide-react';
import type { Space } from '@/types';
import { formatDate } from '@/lib/utils';
import { useSpaceThumbnail } from '@/modules/space/space.queries';
import { SpaceAvatar, spaceAccentColor } from './space-avatar';
import { SpaceTypeBadge } from './space-type-badge';

/** How a space's schedule reads in a card or a header line. */
export function spaceScheduleLabel(space: Space): string {
  if (space.type !== 'SCHEDULED') return 'Starts whenever a member enrolls';
  if (space.startAt === undefined) return 'No start date set';
  const every = space.dripIntervalDays
    ? ` · a section every ${space.dripIntervalDays} day${space.dripIntervalDays === 1 ? '' : 's'}`
    : '';
  return `Starts ${formatDate(space.startAt)}${every}`;
}

/**
 * One space in the organization's list: its cover (or its colour, when it has
 * no cover), its type, and where it stands on the calendar.
 */
export function SpaceCard({ orgId, space }: { orgId: string; space: Space }) {
  const { data: cover } = useSpaceThumbnail(space.spaceId, Boolean(space.thumbnailKey));
  const accent = spaceAccentColor(space);
  const scheduled = space.type === 'SCHEDULED';

  return (
    <Link
      href={`/o/${orgId}/spaces/${space.spaceId}`}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors hover:border-ring/50"
    >
      <div className="relative aspect-video w-full overflow-hidden border-b">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.thumbnailUrl}
            alt={space.title}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}66 100%)` }}
          >
            <div className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-white/90">
              {space.title.trim()[0]?.toUpperCase() ?? '?'}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start gap-2">
          <SpaceAvatar space={space} size="sm" className="mt-0.5" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{space.title}</p>
        </div>

        {space.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{space.description}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <SpaceTypeBadge type={space.type} />
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {scheduled ? <CalendarClockIcon className="size-3" /> : <CirclePlayIcon className="size-3" />}
            {spaceScheduleLabel(space)}
          </span>
        </div>
      </div>
    </Link>
  );
}
