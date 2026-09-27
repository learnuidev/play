import { CalendarClockIcon, GaugeIcon } from 'lucide-react';
import { cn } from '@ui/lib/utils';
import { SPACE_TYPE_LABELS, type SpaceType } from '@play/types';

const ICONS: Record<SpaceType, typeof GaugeIcon> = {
  SELF_PACED: GaugeIcon,
  SCHEDULED: CalendarClockIcon,
};

/** Pill naming a space's type, so the two kinds are told apart at a glance. */
export function SpaceTypeBadge({ type, className }: { type: SpaceType; className?: string }) {
  const Icon = ICONS[type];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      <Icon className="size-3" />
      {SPACE_TYPE_LABELS[type]}
    </span>
  );
}
