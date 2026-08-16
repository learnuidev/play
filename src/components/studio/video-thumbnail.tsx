'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2Icon, SparklesIcon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Video } from '@/types';
import { useGenerateThumbnail, useThumbnail, useUploadThumbnail } from '@/modules/thumbnail/thumbnail.queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const THUMBNAIL_STATUS: Record<string, { label: string; className: string }> = {
  NONE: { label: 'None', className: 'text-muted-foreground' },
  GENERATING: { label: 'Generating…', className: 'text-amber-400' },
  READY: { label: 'Ready', className: 'text-emerald-400' },
  FAILED: { label: 'Failed', className: 'text-destructive' },
};

export function VideoThumbnail({ video }: { video: Video }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const thumbnailStatus = video.thumbnailStatus ?? 'NONE';
  const thumbnailReady = thumbnailStatus === 'READY' && !!video.thumbnailKey;

  const { data: thumbnail } = useThumbnail(video.videoId, thumbnailReady);
  const generate = useGenerateThumbnail(video.videoId);
  const upload = useUploadThumbnail(video.videoId);

  function handleGenerate() {
    generate.mutate(undefined, {
      onSuccess: () => toast.success('Thumbnail generation started'),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to generate thumbnail'),
    });
  }

  async function handleUpload(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file');
      return;
    }

    try {
      setUploading(true);
      const created = await upload.mutateAsync({
        contentType: file.type,
        size: file.size,
      });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(created.upload.method, created.upload.url);
        Object.entries(created.upload.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file);
      });

      toast.success('Thumbnail updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload thumbnail');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const statusStyle = THUMBNAIL_STATUS[thumbnailStatus];

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            <CardTitle>Thumbnail</CardTitle>
          </div>
          <span className={cn('text-xs font-medium', statusStyle?.className)}>
            {statusStyle?.label ?? thumbnailStatus}
          </span>
        </div>
        <CardDescription>
          The poster image shown for this video. Generate one from the video, or upload your own.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-xl border bg-zinc-900">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail.thumbnailUrl}
              alt={video.title}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <ImageIcon className="size-10" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleGenerate}
            disabled={generate.isPending || uploading}
          >
            {generate.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            {generate.isPending ? 'Generating…' : 'Generate thumbnail'}
          </Button>

          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            {uploading ? 'Uploading…' : 'Upload image'}
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files?.[0])}
          />
        </div>

        {thumbnailStatus === 'GENERATING' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Capturing a frame from the video…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
