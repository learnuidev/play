'use client';

import { useState, type ReactNode } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
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
import { NotesEditor } from './notes-editor';
import { VideoPicker } from './video-picker';
import { useCreateContent } from '@api/modules/content/content.queries';
import {
  CONTENT_TYPES,
  CONTENT_TYPE_DESCRIPTIONS,
  CONTENT_TYPE_LABELS,
  type ContentType,
  type NotesDocument,
} from '@play/types';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 120;

/**
 * Adds a piece of content to a section: a lesson, or a quiz.
 *
 * A lesson is what this dialog has always done — a title, a video, notes. A quiz
 * is a title and nothing else, because what a quiz holds is its questions, and
 * they are written on the quiz's own page: a dialog that asked for them here
 * would be a dialog asking for a curriculum in a text field.
 *
 * The kind is therefore the first thing the form asks, and it decides what the
 * rest of the form *is* — which is why it is a pair of buttons stating what each
 * one means rather than a select naming two words.
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
  const [type, setType] = useState<ContentType>('VIDEO');
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
        ...(type === 'QUIZ' ? { type } : {}),
        // A quiz has no video and no notes: sending them would be sending the
        // lesson half of this form to a row that will never render it.
        ...(type === 'VIDEO' && videoId ? { videoId } : {}),
        ...(type === 'VIDEO' && notes ? { notes } : {}),
      });
      toast.success(type === 'QUIZ' ? 'Quiz added' : 'Content added');
      setOpen(false);
      setTitle('');
      setType('VIDEO');
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
            <Label>Kind</Label>
            <div className="flex w-fit gap-0.5 rounded-full bg-muted/70 p-0.5">
              {CONTENT_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setType(option)}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-sm transition-colors',
                    type === option
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {CONTENT_TYPE_LABELS[option]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{CONTENT_TYPE_DESCRIPTIONS[type]}</p>
          </div>

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

          {type === 'VIDEO' ? (
            <>
              <div className="grid gap-2">
                <Label>Video</Label>
                <VideoPicker orgId={orgId} selectedId={videoId} onSelect={(video) => setVideoId(video?.videoId)} />
              </div>

              <div className="grid gap-2">
                <Label>Notes</Label>
                <NotesEditor value={notes} onChange={setNotes} />
              </div>
            </>
          ) : (
            <p className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Questions come next: the quiz opens on its own page, where you can write them, generate
              a first set from a lesson, or import a spreadsheet.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {create.isPending && <Loader2Icon className="animate-spin" />}
            {type === 'QUIZ' ? 'Add quiz' : 'Add content'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
