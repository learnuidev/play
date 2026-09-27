'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FilmIcon, ImageIcon, Loader2Icon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import type { Video } from '@play/types';
import {
  isCustomThumbnail,
  thumbnailKeys,
  useGenerateThumbnail,
  useThumbnail,
  useThumbnailCapture,
  useUploadThumbnail,
} from '@api/modules/thumbnail/thumbnail.queries';
import { Button } from '@ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui/card';

/** How long to keep polling for a captured frame before giving up. */
const CAPTURE_TIMEOUT_MS = 120_000;

export function VideoThumbnail({ video }: { video: Video }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // Poll the video record while the first frame is being captured, so the
  // poster appears on its own once MediaConvert finishes.
  const { data: polled } = useThumbnailCapture(video.videoId, capturing);
  const current = polled?.video ?? video;
  const thumbnailKey = current.thumbnailKey;
  const custom = isCustomThumbnail(thumbnailKey);

  const { data: thumbnail } = useThumbnail(video.videoId, !!thumbnailKey);
  const upload = useUploadThumbnail(video.videoId);
  const generate = useGenerateThumbnail(video.videoId);
  const qc = useQueryClient();

  // The key in place when the capture started. A recapture has to wait for a
  // *different* key: the old first frame is still the current thumbnail until
  // the new one lands.
  const capturedFromRef = useRef<string | undefined>(undefined);

  // The capture landed: stop polling, re-sign the new thumbnail key and let the
  // user know.
  useEffect(() => {
    if (!capturing) return;
    if (!thumbnailKey || thumbnailKey === capturedFromRef.current) return;
    setCapturing(false);
    qc.invalidateQueries({ queryKey: thumbnailKeys.detail(video.videoId) });
    toast.success('Thumbnail created from the video’s first frame');
  }, [capturing, thumbnailKey, qc, video.videoId]);

  useEffect(() => {
    if (!capturing) return;
    const timer = setTimeout(() => {
      setCapturing(false);
      toast.error('Thumbnail capture is taking longer than expected');
    }, CAPTURE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [capturing]);

  async function handleCapture() {
    try {
      capturedFromRef.current = thumbnailKey;
      setCapturing(true);
      await generate.mutateAsync();
      toast.success('Capturing the first frame…');
    } catch (err) {
      setCapturing(false);
      toast.error(err instanceof Error ? err.message : 'Failed to capture a thumbnail');
    }
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

  const statusLabel = custom
    ? 'Custom'
    : thumbnailKey
      ? 'First frame'
      : capturing
        ? 'Capturing…'
        : 'None';

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
              thumbnailKey ? 'text-emerald-400' : 'text-muted-foreground',
            )}
          >
            {statusLabel}
          </span>
        </div>
        <CardDescription>
          The poster image shown for this video. Every video falls back to its own
          first frame; upload an image to replace it.
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
          ) : capturing ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2Icon className="size-6 animate-spin" />
              <span className="text-xs">Capturing first frame…</span>
            </div>
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

          {video.status === 'READY' && !custom && (
            <Button variant="outline" onClick={handleCapture} disabled={capturing}>
              {capturing ? <Loader2Icon className="animate-spin" /> : <FilmIcon />}
              {capturing
                ? 'Capturing…'
                : thumbnailKey
                  ? 'Recapture first frame'
                  : 'Use first frame'}
            </Button>
          )}

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
