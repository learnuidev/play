'use client';

import { useRef, useState } from 'react';
import { DownloadIcon, FileIcon, Loader2Icon, PaperclipIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useContentFiles, useDeleteContentFile, useUploadContentFile } from '@/modules/content/content.queries';
import type { ContentFileWithUrl } from '@/types';

/** Bytes as a person reads them. */
function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * One attachment. The link is the signed CloudFront URL the API handed back, so
 * a click fetches the object through the distribution rather than through the
 * API — and the browser decides whether to show it or save it, from the type it
 * was uploaded with.
 */
function FileRow({
  file,
  canEdit,
  onDelete,
  deleting,
}: {
  file: ContentFileWithUrl;
  canEdit: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {[formatBytes(file.size), formatDate(file.createdAt)].filter(Boolean).join(' · ')}
        </p>
      </div>

      {file.url && (
        <Button variant="ghost" size="icon" className="size-8" asChild>
          <a href={file.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.name}`}>
            <DownloadIcon />
          </a>
        </Button>
      )}

      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          disabled={deleting}
          aria-label={`Remove ${file.name}`}
        >
          {deleting ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
        </Button>
      )}
    </div>
  );
}

/**
 * The files attached to a lesson.
 *
 * Uploading is a two-step the component hides: the API reserves the attachment
 * and returns a presigned S3 URL, then the bytes go straight there with
 * progress, because a `fetch` cannot report it.
 */
export function ContentFiles({ contentId, canEdit }: { contentId: string; canEdit: boolean }) {
  const { data, isLoading } = useContentFiles(contentId);
  const upload = useUploadContentFile(contentId);
  const remove = useDeleteContentFile(contentId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const files = data?.files ?? [];

  async function handleFiles(selected: FileList | null) {
    if (!selected?.length) return;

    for (const file of Array.from(selected)) {
      setProgress(0);
      try {
        await upload.mutateAsync({ file, onProgress: setProgress });
      } catch (err) {
        toast.error(
          err instanceof Error ? `Could not upload ${file.name}: ${err.message}` : `Could not upload ${file.name}`,
        );
      }
    }

    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function deleteFile(file: ContentFileWithUrl) {
    setDeletingId(file.fileId);
    try {
      await remove.mutateAsync(file.fileId);
      toast.success('File removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the file');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid gap-3">
      {canEdit && (
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            {progress === null ? 'Attach files' : `Uploading… ${progress}%`}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      ) : files.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground">
          <PaperclipIcon className="size-4" />
          {canEdit ? 'No files attached yet.' : 'No files attached to this lesson.'}
        </p>
      ) : (
        <div className="grid gap-2">
          {files.map((file) => (
            <FileRow
              key={file.fileId}
              file={file}
              canEdit={canEdit}
              deleting={deletingId === file.fileId}
              onDelete={() => void deleteFile(file)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
