'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FilmIcon, Loader2Icon, UploadIcon } from 'lucide-react';
import { useCreateVideo } from '@/modules/video/video.queries';
import { cn, computeAspectRatio, resolutionTierFor } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

/** Reads resolution + duration from the browser before upload. */
function probeVideo(file: File): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
    };

    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10_000);

    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const meta: VideoMeta = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      };
      cleanup();
      resolve(meta.width && meta.height ? meta : null);
    };

    video.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      resolve(null);
    };

    video.src = url;
  });
}

/** The organization is fixed by the route the form is rendered on. */
export function UploadForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const create = useCreateVideo();

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    setFile(f);
    setMeta(null);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    probeVideo(f).then(setMeta);
  }

  async function handleUpload() {
    setError(null);
    if (!file) {
      setError('Choose a video file to upload');
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    try {
      setUploading(true);
      setProgress(0);
      const created = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        organizationId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        ...(meta
          ? {
              width: meta.width,
              height: meta.height,
              duration: meta.duration,
              aspectRatio: computeAspectRatio(meta.width, meta.height),
              resolutionTier: resolutionTierFor(meta.width, meta.height),
            }
          : {}),
      });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(created.upload.method, created.upload.url);
        Object.entries(created.upload.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file);
      });

      router.push(`/o/${organizationId}/videos/${created.video.videoId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors',
          dragging ? 'border-ring bg-muted/40' : 'border-border hover:border-ring/60 hover:bg-muted/20',
        )}
      >
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <div className="flex size-14 items-center justify-center rounded-2xl border bg-muted/40">
          {file ? <FilmIcon className="size-6 text-foreground" /> : <UploadIcon className="size-6 text-muted-foreground" />}
        </div>
        {file ? (
          <div>
            <p className="text-sm font-medium">{file.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium">Drop a video here, or click to browse</p>
            <p className="mt-1 text-xs text-muted-foreground">MP4, MOV, WebM, and more</p>
          </div>
        )}
      </div>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="video-title">Title</Label>
          <Input
            id="video-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="My awesome video"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="video-desc">Description</Label>
          <Textarea
            id="video-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
          />
        </div>
      </div>

      {uploading && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uploading…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button size="lg" onClick={handleUpload} disabled={uploading} className="w-full">
        {uploading ? (
          <>
            <Loader2Icon className="animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <UploadIcon />
            Upload video
          </>
        )}
      </Button>
    </div>
  );
}
