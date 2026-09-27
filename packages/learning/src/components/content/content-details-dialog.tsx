'use client';

import { useState, type ReactNode } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ui/components/ui/dialog';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { VideoPicker } from './video-picker';
import { useUpdateContent } from '@api/modules/content/content.queries';
import type { Content } from '@play/types';

// Mirrors the server-side limit, so the form fails fast instead of round-tripping.
const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 120;

/**
 * Changes what a lesson is called and which video it plays.
 *
 * Notes are edited on the lesson's own page rather than in here: a rich text
 * editor wants the width of a page, not of a modal.
 */
export function ContentDetailsDialog({
  orgId,
  spaceId,
  content,
  trigger,
  open,
  onOpenChange,
}: {
  orgId: string;
  spaceId: string;
  content: Content;
  trigger?: ReactNode;
  /** Controlled openness. Omit to let the trigger manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const [title, setTitle] = useState(content.title);
  const [videoId, setVideoId] = useState<string | undefined>(content.videoId);

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolled;

  const update = useUpdateContent(content.contentId, spaceId);

  const trimmedTitle = title.trim();
  const titleTooShort = trimmedTitle.length > 0 && trimmedTitle.length < MIN_TITLE_LENGTH;
  const canSubmit = trimmedTitle.length >= MIN_TITLE_LENGTH && !update.isPending;

  // Opening shows the lesson as it now is, not as it was when the page loaded.
  function setOpen(next: boolean) {
    if (next) {
      setTitle(content.title);
      setVideoId(content.videoId);
    }
    if (isControlled) onOpenChange?.(next);
    else setUncontrolled(next);
  }

  async function submit() {
    try {
      await update.mutateAsync({
        title: trimmedTitle,
        // An unchanged video is still sent, so the one request says what the
        // lesson is: `null` is what unlinks it, and that is a deliberate choice
        // made in the picker.
        videoId: videoId ?? null,
      });
      toast.success('Content updated');
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the content');
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit content</DialogTitle>
          <DialogDescription>Its title, and the video it plays.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="content-edit-title">Title</Label>
            <Input
              id="content-edit-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
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
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {update.isPending && <Loader2Icon className="animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
