'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BookOpenIcon,
  CheckIcon,
  GraduationCapIcon,
  HelpCircleIcon,
  ImageIcon,
  LayersIcon,
  Loader2Icon,
  SaveIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { putFileToPresignedUrl } from '@api/lib/upload';
import {
  DEFAULT_DRIP_INTERVAL_DAYS,
  SPACE_COLORS,
  SPACE_TYPES,
  SPACE_TYPE_DESCRIPTIONS,
  SPACE_TYPE_LABELS,
  type Space,
  type SpaceType,
} from '@play/types';
import {
  useSpaceStats,
  useSpaceThumbnail,
  useUpdateSpace,
  useUploadSpaceThumbnail,
} from '@api/modules/space/space.queries';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Skeleton } from '@ui/components/ui/skeleton';
import { Textarea } from '@ui/components/ui/textarea';
import { BlockLabel } from '@/components/shell/page-card';
import { SpaceMarketplaceCard } from '@/components/space/space-marketplace-card';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MIN_DRIP_INTERVAL_DAYS = 1;
const MAX_DRIP_INTERVAL_DAYS = 365;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

/**
 * What a course adds up to, as four numbers.
 *
 * Read on their own request rather than with the course, because they are
 * counts: the page renders on the title, and a number that takes a moment to
 * arrive must not hold it up. A dash stands in while they load rather than a
 * zero, because a zero is a fact and "not yet known" is not.
 */
function StatTile({
  icon,
  label,
  value,
  loading,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  loading: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card px-5 py-4">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
        {loading ? <Skeleton className="h-8 w-12" /> : (value ?? 0)}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One of the accent colours, as a choice rather than a text field. */
function ColorSwatch({
  color,
  selected,
  onSelect,
  label,
  disabled,
}: {
  color: string | null;
  selected: boolean;
  onSelect: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={cn(
        'flex size-8 items-center justify-center rounded-full border transition-all',
        selected ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : 'hover:scale-105',
        !color && 'border-dashed',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {selected && <CheckIcon className={cn('size-4', color ? 'text-white' : 'text-foreground')} />}
    </button>
  );
}

/**
 * The course's own details: its banner, its name, what it says about itself, the
 * colour it wears, and how it runs.
 *
 * Saved as one form rather than field by field, because these are the things
 * that are decided together — and because the API takes a patch, only what
 * changed is written.
 *
 * A viewer sees the same fields disabled rather than a different page: what a
 * course is, is worth reading either way, and a form that turns into prose is a
 * second layout to keep true.
 */
function CourseDetailsForm({ space, canEdit }: { space: Space; canEdit: boolean }) {
  const [title, setTitle] = useState(space.title);
  const [description, setDescription] = useState(space.description);
  const [type, setType] = useState<SpaceType>(space.type);
  const [startDate, setStartDate] = useState(toDateInput(space.startAt));
  const [dripIntervalDays, setDripIntervalDays] = useState(
    String(space.dripIntervalDays ?? DEFAULT_DRIP_INTERVAL_DAYS),
  );
  const [color, setColor] = useState<string | null>(space.color ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const update = useUpdateSpace(space.spaceId);
  const uploadCover = useUploadSpaceThumbnail();
  const { data: cover } = useSpaceThumbnail(space.spaceId, Boolean(space.thumbnailKey));

  // The course may change under the form — a save, or somebody else's edit
  // arriving with the list — so the fields follow it rather than holding the
  // values they were mounted with.
  useEffect(() => {
    setTitle(space.title);
    setDescription(space.description);
    setType(space.type);
    setStartDate(toDateInput(space.startAt));
    setDripIntervalDays(String(space.dripIntervalDays ?? DEFAULT_DRIP_INTERVAL_DAYS));
    setColor(space.color ?? null);
  }, [space]);

  const scheduled = type === 'SCHEDULED';
  const trimmedTitle = title.trim();
  const drip = Number(dripIntervalDays);
  const dripValid =
    Number.isInteger(drip) && drip >= MIN_DRIP_INTERVAL_DAYS && drip <= MAX_DRIP_INTERVAL_DAYS;
  const canSave =
    canEdit &&
    trimmedTitle.length >= MIN_TITLE_LENGTH &&
    (!scheduled || (Boolean(startDate) && dripValid));

  async function changeBanner(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file for the banner');
      return;
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      toast.error('Banners must be 5 MB or smaller');
      return;
    }

    setUploading(true);
    try {
      const reserved = await uploadCover.mutateAsync({
        spaceId: space.spaceId,
        contentType: file.type,
        size: file.size,
      });
      await putFileToPresignedUrl(file, reserved.upload);
      toast.success('Banner updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload the banner');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    try {
      await update.mutateAsync({
        title: trimmedTitle,
        description: description.trim(),
        // An empty colour is how "no colour" is said: the course goes back to
        // the one derived from its id.
        color: color ?? '',
        type,
        ...(scheduled ? { startAt: startDate, dripIntervalDays: drip } : {}),
      });
      toast.success('Course updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the course');
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <Label htmlFor="space-banner">Banner</Label>
        <div className="relative aspect-[3/1] w-full overflow-hidden rounded-2xl border bg-muted/40">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImageIcon className="size-5" />
              <span className="text-xs">No banner</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            id="space-banner"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void changeBanner(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canEdit || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2Icon className="animate-spin" /> : <ImageIcon />}
            {uploading ? 'Uploading…' : space.thumbnailKey ? 'Replace banner' : 'Upload banner'}
          </Button>
          <p className="text-xs text-muted-foreground">JPEG or PNG, up to 5 MB.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="space-title">Title</Label>
          <Input
            id="space-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            disabled={!canEdit}
          />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="space-description">Description</Label>
          <Textarea
            id="space-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_DESCRIPTION_LENGTH}
            rows={3}
            disabled={!canEdit}
          />
        </div>
      </div>

      <fieldset className="grid gap-3" disabled={!canEdit}>
        <legend className="text-sm font-medium">How it runs</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {SPACE_TYPES.map((option) => {
            const selected = option === type;
            return (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer flex-col gap-1.5 rounded-xl border px-4 py-3 transition-colors',
                  selected ? 'border-ring bg-muted/50' : 'hover:bg-muted/40',
                  !canEdit && 'cursor-not-allowed opacity-70',
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="space-type"
                    value={option}
                    checked={selected}
                    onChange={() => setType(option)}
                    className="size-4 accent-foreground"
                  />
                  <span className="text-sm font-medium">{SPACE_TYPE_LABELS[option]}</span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {SPACE_TYPE_DESCRIPTIONS[option]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {scheduled && (
        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="space-start">Start date</Label>
            <Input
              id="space-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">Section 1 unlocks on this day.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="space-drip">Unlock a section every</Label>
            <div className="flex items-center gap-2">
              <Input
                id="space-drip"
                type="number"
                min={MIN_DRIP_INTERVAL_DAYS}
                max={MAX_DRIP_INTERVAL_DAYS}
                value={dripIntervalDays}
                onChange={(e) => setDripIntervalDays(e.target.value)}
                className="w-24"
                disabled={!canEdit}
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>
          {/* Switching a live course to scheduled gives it a date and a cadence
              without touching anybody's progress: what has been read stays read,
              and what unlocks next is what changes. */}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Changing how a course runs changes what unlocks next. Nothing anybody has already
            finished is affected.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        <Label>Colour</Label>
        <div className="flex flex-wrap items-center gap-2">
          <ColorSwatch
            color={null}
            selected={color === null}
            onSelect={() => setColor(null)}
            label="No colour — pick one for me"
            disabled={!canEdit}
          />
          {SPACE_COLORS.map((option) => (
            <ColorSwatch
              key={option}
              color={option}
              selected={color === option}
              onSelect={() => setColor(option)}
              label={option}
              disabled={!canEdit}
            />
          ))}
          <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="color"
              value={color ?? '#6366f1'}
              onChange={(e) => setColor(e.target.value)}
              disabled={!canEdit}
              className="size-8 cursor-pointer rounded-full border bg-transparent p-0.5 disabled:cursor-not-allowed"
            />
            Custom
          </label>
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          <Button onClick={() => void save()} disabled={!canSave || update.isPending}>
            {update.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** `yyyy-mm-dd` for a date input, in the same UTC day the API pinned it to. */
function toDateInput(epochMs: number | undefined): string {
  if (!epochMs) return '';
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * The overview: what the course adds up to, and everything about it that is
 * decided rather than read.
 *
 * The numbers come first because they are the question the page is opened with —
 * how many are taking this, how long is it — and the form below is what the
 * author came to change.
 */
export function SpaceOverviewTab({ space, canEdit }: { space: Space; canEdit: boolean }) {
  const { data, isLoading } = useSpaceStats(space.spaceId);
  const stats = data?.stats;
  const isScheduled = space.type === 'SCHEDULED';

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <BlockLabel>Overview</BlockLabel>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<GraduationCapIcon className="size-3.5" />}
            label="Students"
            value={stats?.students}
            loading={isLoading}
          />
          <StatTile
            icon={<LayersIcon className="size-3.5" />}
            label="Sections"
            value={stats?.sections}
            loading={isLoading}
          />
          <StatTile
            icon={<BookOpenIcon className="size-3.5" />}
            label="Lessons"
            value={stats?.contents}
            loading={isLoading}
          />
          <StatTile
            icon={<HelpCircleIcon className="size-3.5" />}
            label="Quizzes"
            value={stats?.quizzes}
            loading={isLoading}
            hint="Quizzes are not part of a course yet."
          />
        </div>
        {isScheduled && (
          <p className="text-sm text-muted-foreground">
            Sections unlock every {space.dripIntervalDays ?? DEFAULT_DRIP_INTERVAL_DAYS} days from
            the start date.
          </p>
        )}
      </section>

      <section className="grid gap-3">
        <BlockLabel>Details</BlockLabel>
        <div className="rounded-3xl border border-border/60 bg-card p-5">
          <CourseDetailsForm space={space} canEdit={canEdit} />
        </div>
      </section>

      {/* Last, because publishing is the end of writing a course rather than
          another field to fill in on the way through it. */}
      <SpaceMarketplaceCard space={space} canEdit={canEdit} />
    </div>
  );
}
