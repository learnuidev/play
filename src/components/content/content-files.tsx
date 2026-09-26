'use client';

import { useRef, useState } from 'react';
import { FileIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
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
  const meta = [formatBytes(file.size), formatDate(file.createdAt)].filter(Boolean).join(' · ');

  return (
    <div className="group/row flex items-center gap-3 rounded-lg py-2 pl-2 pr-1 transition-colors hover:bg-background">
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground/70" />

      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-2 hover:underline"
      >
        {file.name}
      </a>

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>

      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground/50 opacity-0 transition-colors hover:text-destructive group-hover/row:opacity-100 max-sm:opacity-100"
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
    <div className="grid gap-0.5">
      {isLoading ? (
        <div className="grid gap-2 py-1">
          <Skeleton className="h-8 rounded-lg" />
          <Skeleton className="h-8 rounded-lg" />
        </div>
      ) : (
        <>
          {files.map((file) => (
            <FileRow
              key={file.fileId}
              file={file}
              canEdit={canEdit}
              deleting={deletingId === file.fileId}
              onDelete={() => void deleteFile(file)}
            />
          ))}

          {!canEdit && files.length === 0 && (
            <p className="py-2 pl-2 text-sm text-muted-foreground">No files attached to this lesson.</p>
          )}
        </>
      )}

      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void handleFiles(event.target.files)}
          />
          {/* The last line of the list, where an author expects to find it. */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="flex items-center gap-3 rounded-lg py-2 pl-2 text-left text-sm text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            {upload.isPending ? (
              <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <PlusIcon className="size-3.5 shrink-0" />
            )}
            {progress === null ? 'Attach files' : `Uploading… ${progress}%`}
          </button>
        </>
      )}
    </div>
  );
}
