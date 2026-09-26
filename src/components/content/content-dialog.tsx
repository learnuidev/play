'use client';

import { useState, type ReactNode } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NotesEditor } from './notes-editor';
import { VideoPicker } from './video-picker';
import { useCreateContent } from '@/modules/content/content.queries';
import type { NotesDocument } from '@/types';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 120;

/**
 * Adds a piece of content to a section: what it is called, which video it
 * plays, and the notes that go with it.
 *
 * Files are attached afterwards, on the content's own page, because an upload
 * needs the content to exist first — the presigned URL is issued against its id.
 */
export function ContentDialog({
  orgId,
  spaceId,
  sectionId,
  sectionTitle,
  trigger,
}: {
  orgId: string;
  spaceId: string;
  sectionId: string;
  sectionTitle: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [videoId, setVideoId] = useState<string | undefined>();
  const [notes, setNotes] = useState<NotesDocument | undefined>();

  const create = useCreateContent(sectionId, spaceId);

  const trimmedTitle = title.trim();
  const titleTooShort = trimmedTitle.length > 0 && trimmedTitle.length < MIN_TITLE_LENGTH;
  const canSubmit = trimmedTitle.length >= MIN_TITLE_LENGTH && !create.isPending;

  async function submit() {
    try {
      await create.mutateAsync({
        title: trimmedTitle,
        ...(videoId ? { videoId } : {}),
        ...(notes ? { notes } : {}),
      });
      toast.success('Content added');
      setOpen(false);
      setTitle('');
      setVideoId(undefined);
      setNotes(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the content');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New content</DialogTitle>
          <DialogDescription>Filed under “{sectionTitle}”.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="content-title">Title</Label>
            <Input
              id="content-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Why editing rhythm matters"
              maxLength={MAX_TITLE_LENGTH}
              autoFocus
            />
            {titleTooShort && (
              <p className="text-xs text-destructive">
                At least {MIN_TITLE_LENGTH} characters — “{trimmedTitle}” is too short.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Video</Label>
            <VideoPicker orgId={orgId} selectedId={videoId} onSelect={(video) => setVideoId(video?.videoId)} />
          </div>

          <div className="grid gap-2">
            <Label>Notes</Label>
            <NotesEditor value={notes} onChange={setNotes} />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {create.isPending && <Loader2Icon className="animate-spin" />}
            Add content
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
