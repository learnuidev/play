import type { VideoStatus } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<VideoStatus, { dot: string; badge: string; label: string }> = {
  UPLOADING: {
    dot: 'bg-blue-400',
    badge: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    label: 'Uploading',
  },
  PROCESSING: {
    dot: 'bg-amber-400',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    label: 'Processing',
  },
  READY: {
    dot: 'bg-emerald-400',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    label: 'Ready',
  },
  FAILED: {
    dot: 'bg-red-400',
    badge: 'border-red-500/30 bg-red-500/10 text-red-400',
    label: 'Failed',
  },
};

export function VideoStatusBadge({ status, className }: { status: VideoStatus; className?: string }) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn('gap-1.5', style.badge, className)}>
      <span className={cn('size-1.5 rounded-full', style.dot, status === 'PROCESSING' && 'animate-pulse')} />
      {style.label}
    </Badge>
  );
}
