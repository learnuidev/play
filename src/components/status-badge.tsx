'use client';

import type { VideoStatus } from '@/types';
import { VIDEO_STATUS_LABELS } from '@/types';

export function StatusBadge({ status }: { status: VideoStatus }) {
  return <span className={`badge badge-${status}`}>{VIDEO_STATUS_LABELS[status]}</span>;
}
