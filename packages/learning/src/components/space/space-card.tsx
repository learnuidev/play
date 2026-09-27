'use client';

import Link from 'next/link';
import { CalendarClockIcon, CirclePlayIcon } from 'lucide-react';
import type { CourseSummary } from '@play/types';
import { formatDate } from '@ui/lib/utils';
import { useSpaceThumbnail } from '@api/modules/space/space.queries';
import { SpaceAvatar, spaceAccentColor } from './space-avatar';
import { SpaceTypeBadge } from './space-type-badge';

/** How a space's schedule reads in a card or a header line. */
export function spaceScheduleLabel(space: CourseSummary): string {
  if (space.type !== 'SCHEDULED') return 'Starts whenever a member enrolls';
  if (space.startAt === undefined) return 'No start date set';
  const every = space.dripIntervalDays
    ? ` · a section every ${space.dripIntervalDays} day${space.dripIntervalDays === 1 ? '' : 's'}`
    : '';
  return `Starts ${formatDate(space.startAt)}${every}`;
}

/**
 * One course in a list: its cover (or its colour, when it has no cover), its
 * type, and where it stands on the calendar.
 *
 * The card draws a course and says where it goes; the app that lists courses
 * says what a course's URL is. That is the difference between the studio's
 * `/o/{orgId}/spaces/{spaceId}` — a course inside a community — and the
 * marketplace's `/courses/{spaceId}`, a course anybody may look at, and it is
 * the only thing the two listings do not share.
 */
export function SpaceCard({
  href,
  space,
  coverUrl,
  footer,
}: {
  href: string;
  space: CourseSummary;
  /**
   * The cover, when the caller already has it.
   *
   * The studio reads a course's cover from the space's own thumbnail endpoint,
   * which wants a token; the marketplace is handed a signed URL inside the
   * catalog response, because the people reading *it* have not signed in. A
   * card given one does not ask again.
   */
  coverUrl?: string;
  /** A badge or a line of its own under the course's own details. */
  footer?: React.ReactNode;
}) {
  const { data: fetched } = useSpaceThumbnail(
    space.spaceId,
    Boolean(space.thumbnailKey) && !coverUrl,
  );
  const cover = coverUrl ? { thumbnailUrl: coverUrl } : fetched;
  const accent = spaceAccentColor(space);
  const scheduled = space.type === 'SCHEDULED';

  return (
    <Link
      href={href}
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

        {footer}
      </div>
    </Link>
  );
}
