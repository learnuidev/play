'use client';

import { useEffect, useState, type ReactNode } from 'react';
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
import { Textarea } from '@ui/components/ui/textarea';
import { useCreateSection, useUpdateSection } from '@api/modules/section/section.queries';
import type { Section } from '@play/types';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Creates a section, or renames one.
 *
 * The same dialog in both directions: a section is a title and a description,
 * and whether it exists yet is the only difference between the two modes.
 *
 * It can be driven either by a trigger of its own or from the outside by
 * passing `open` — which is what lets a menu item open it. A dialog nested in a
 * menu item fights the menu for focus, so the menu closes first and this opens
 * on the next tick instead.
 */
export function SectionDialog({
  spaceId,
  section,
  trigger,
  open,
  onOpenChange,
}: {
  spaceId: string;
  /** Omit to create a new section. */
  section?: Section;
  trigger?: ReactNode;
  /** Controlled openness. Omit to let the trigger manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const [title, setTitle] = useState(section?.title ?? '');
  const [description, setDescription] = useState(section?.description ?? '');

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolled;
  const setOpen = (next: boolean) => (isControlled ? onOpenChange?.(next) : setUncontrolled(next));

  const create = useCreateSection(spaceId);
  const update = useUpdateSection(spaceId, section?.sectionId ?? '');
  const pending = create.isPending || update.isPending;

  // Opening shows the section as it now is, not as it was when the page loaded.
  useEffect(() => {
    if (!isOpen) return;
    setTitle(section?.title ?? '');
    setDescription(section?.description ?? '');
  }, [isOpen, section]);

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
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{section ? 'Rename section' : 'New section'}</DialogTitle>
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
            {section ? 'Save' : 'Add section'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
