'use client';

import type { Video } from '@play/types';
import { VIDEO_STATUS_LABELS } from '@play/types';
import { formatDuration } from '@ui/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui/card';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface InfoFieldProps {
  label: string;
  value: string;
}

function InfoField({ label, value }: InfoFieldProps) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

export function VideoGeneralInfo({ video }: { video: Video }) {
  const resolution =
    video.width && video.height
      ? `${video.width}×${video.height}${video.resolutionTier ? ` · ${video.resolutionTier}` : ''}`
      : '—';

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>General info</CardTitle>
        <CardDescription>Read-only details captured when the video was uploaded.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          <InfoField label="File name" value={video.fileName} />
          <InfoField label="Status" value={VIDEO_STATUS_LABELS[video.status]} />
          <InfoField label="Resolution" value={resolution} />
          <InfoField label="Duration" value={video.duration !== undefined ? formatDuration(video.duration) : '—'} />
          <InfoField label="Aspect ratio" value={video.aspectRatio ?? '—'} />
          <InfoField label="File size" value={formatBytes(video.size)} />
          <InfoField label="Uploaded" value={formatDate(video.createdAt)} />
        </dl>
      </CardContent>
    </Card>
  );
}
