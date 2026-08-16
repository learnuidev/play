'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2Icon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Video } from '@/types';
import { useThumbnail, useUploadThumbnail } from '@/modules/thumbnail/thumbnail.queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function VideoThumbnail({ video }: { video: Video }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const thumbnailReady = !!video.thumbnailKey;

  const { data: thumbnail } = useThumbnail(video.videoId, thumbnailReady);
  const upload = useUploadThumbnail(video.videoId);

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

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            <CardTitle>Thumbnail</CardTitle>
          </div>
          <span
            className={cn(
              'text-xs font-medium',
              thumbnailReady ? 'text-emerald-400' : 'text-muted-foreground',
            )}
          >
            {thumbnailReady ? 'Ready' : 'None'}
          </span>
        </div>
        <CardDescription>
          The poster image shown for this video. Upload your own image.
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
      </CardContent>
    </Card>
  );
}
