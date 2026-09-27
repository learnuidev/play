'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateCohort, useUpdateCohort } from '@/modules/cohort/cohort.queries';
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
import type { CohortWithMembers } from '@/types';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

/** The stored instant back into the `yyyy-mm-dd` a date input takes, in the same UTC day. */
function isoToDate(value?: number): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Creates a cohort, or edits one.
 *
 * The same dialog in both directions: a cohort is a name, what it is for, and an
 * optional run of dates, and whether it exists yet is the only difference. The
 * run is optional because plenty of cohorts are not dated at all — a team, or a
 * tutorial group that runs as long as the course does.
 *
 * It can be driven either by a trigger of its own or from the outside by passing
 * `open`, which is what lets a card's Edit button open it for one cohort.
 */
export function CohortDialog({
  spaceId,
  cohort,
  trigger,
  open,
  onOpenChange,
}: {
  spaceId: string;
  /** Omit to create a new cohort. */
  cohort?: CohortWithMembers;
  trigger?: ReactNode;
  /** Controlled openness. Omit to let the trigger manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const [uncontrolled, setUncontrolled] = useState(false);
  const [name, setName] = useState(cohort?.name ?? '');
  const [description, setDescription] = useState(cohort?.description ?? '');
  /** `yyyy-mm-dd` values straight from the date inputs. */
  const [startDate, setStartDate] = useState(isoToDate(cohort?.startAt));
  const [endDate, setEndDate] = useState(isoToDate(cohort?.endAt));

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolled;

  const create = useCreateCohort(spaceId);
  const update = useUpdateCohort(spaceId);
  const pending = create.isPending || update.isPending;

  function reset() {
    setName(cohort?.name ?? '');
    setDescription(cohort?.description ?? '');
    setStartDate(isoToDate(cohort?.startAt));
    setEndDate(isoToDate(cohort?.endAt));
  }

  function setOpen(next: boolean) {
    if (!next) reset();
    if (isControlled) onOpenChange?.(next);
    else setUncontrolled(next);
  }

  // Opening shows the cohort as it now is, not as it was when the page loaded:
  // somebody may have renamed it, or moved its dates, in another tab.
  useEffect(() => {
    if (!isOpen) return;
    setName(cohort?.name ?? '');
    setDescription(cohort?.description ?? '');
    setStartDate(isoToDate(cohort?.startAt));
    setEndDate(isoToDate(cohort?.endAt));
  }, [isOpen, cohort]);

  const trimmedName = name.trim();
  const nameTooShort = trimmedName.length > 0 && trimmedName.length < MIN_NAME_LENGTH;
  const nameTooLong = trimmedName.length > MAX_NAME_LENGTH;
  // Both values are `yyyy-mm-dd`, so comparing them as text compares them as
  // dates; there is no need to parse them back into instants to validate.
  const runBackwards = Boolean(startDate && endDate && endDate < startDate);
  const canSubmit =
    trimmedName.length >= MIN_NAME_LENGTH && !nameTooLong && !runBackwards && !pending;

  async function submit() {
    if (!canSubmit) return;

    const shared = { name: trimmedName, description: description.trim() };

    try {
      if (cohort) {
        await update.mutateAsync({
          cohortId: cohort.cohortId,
          ...shared,
          // A cleared date is sent as null, not left out: an omitted field means
          // "unchanged" to the API, so leaving it out would keep the old
          // schedule on a cohort whose run has just been taken off it.
          //
          // The `yyyy-mm-dd` goes as it stands. The API pins a date-only value
          // to UTC midnight, so the day picked is the day stored wherever it is
          // read; an instant built from this browser's midnight would file a
          // September intake under 31 August for anybody west of Greenwich.
          startAt: startDate || null,
          endAt: endDate || null,
        });
        toast.success('Cohort updated');
      } else {
        await create.mutateAsync({
          ...shared,
          // Nothing to clear on a cohort that does not exist yet, so an empty
          // date is simply absent from the first version of it.
          ...(startDate ? { startAt: startDate } : {}),
          ...(endDate ? { endAt: endDate } : {}),
        });
        toast.success('Cohort created');
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the cohort');
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{cohort ? 'Edit cohort' : 'New cohort'}</DialogTitle>
          <DialogDescription>
            {cohort
              ? 'Rename this cohort, say what it is for, or move its dates. Its members are not affected.'
              : 'A cohort groups members of this course — an intake, a team, or a tutorial group.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cohort-name">Name</Label>
            <Input
              id="cohort-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="September intake"
              maxLength={MAX_NAME_LENGTH}
              autoFocus
            />
            {nameTooShort ? (
              <p className="text-xs text-destructive">
                At least {MIN_NAME_LENGTH} characters — “{trimmedName}” is too short.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{MAX_NAME_LENGTH} characters max</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cohort-description">Description</Label>
            <Textarea
              id="cohort-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Who this group is, in a sentence (optional)"
              rows={3}
              maxLength={MAX_DESCRIPTION_LENGTH}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/{MAX_DESCRIPTION_LENGTH}
            </p>
          </div>

          <fieldset className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">Run (optional)</legend>
            <div className="grid gap-2">
              <Label htmlFor="cohort-start">Starts</Label>
              <Input
                id="cohort-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cohort-end">Ends</Label>
              <Input
                id="cohort-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Leave both empty for a group that is not tied to dates. Clearing a date takes the
              schedule off the cohort.
            </p>
          </fieldset>

          {runBackwards && (
            <p className="text-xs text-destructive">The end date cannot be before the start date.</p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
            {pending && <Loader2Icon className="animate-spin" />}
            {cohort ? 'Save' : 'Create cohort'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
