'use client';

import { useEffect, useState, type ReactNode } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useCreateSection, useUpdateSection } from '@/modules/section/section.queries';
import type { Section } from '@/types';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Creates a section, or renames one.
 *
 * The same dialog in both directions: a section is a title and a description,
 * and whether it exists yet is the only difference between the two modes.
 */
export function SectionDialog({
  spaceId,
  section,
  trigger,
}: {
  spaceId: string;
  /** Omit to create a new section. */
  section?: Section;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(section?.title ?? '');
  const [description, setDescription] = useState(section?.description ?? '');

  const create = useCreateSection(spaceId);
  const update = useUpdateSection(spaceId, section?.sectionId ?? '');
  const pending = create.isPending || update.isPending;

  // Reopening after a failed attempt should show what was typed last time, not
  // what the section said when the page loaded.
  useEffect(() => {
    if (!open) return;
    setTitle(section?.title ?? '');
    setDescription(section?.description ?? '');
  }, [open, section]);

  const trimmedTitle = title.trim();
  const titleTooShort = trimmedTitle.length > 0 && trimmedTitle.length < MIN_TITLE_LENGTH;
  const titleTooLong = trimmedTitle.length > MAX_TITLE_LENGTH;
  const canSubmit = trimmedTitle.length >= MIN_TITLE_LENGTH && !titleTooLong && !pending;

  async function submit() {
    const payload = { title: trimmedTitle, description: description.trim() };

    try {
      if (section) {
        await update.mutateAsync(payload);
        toast.success('Section updated');
      } else {
        await create.mutateAsync(payload);
        toast.success('Section added');
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the section');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{section ? 'Edit section' : 'New section'}</DialogTitle>
          <DialogDescription>
            {section
              ? 'Rename this section or change what it says it covers.'
              : 'A section is a heading over the lessons that follow it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="section-title">Title</Label>
            <Input
              id="section-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Getting started"
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
            <Label htmlFor="section-description">Description</Label>
            <Textarea
              id="section-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this section covers."
              rows={3}
              maxLength={MAX_DESCRIPTION_LENGTH}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/{MAX_DESCRIPTION_LENGTH}
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {pending && <Loader2Icon className="animate-spin" />}
            {section ? 'Save changes' : 'Add section'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
