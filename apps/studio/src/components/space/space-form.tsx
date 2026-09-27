'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon, ImageIcon, Loader2Icon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { putFileToPresignedUrl } from '@api/lib/upload';
import {
  DEFAULT_DRIP_INTERVAL_DAYS,
  SPACE_COLORS,
  SPACE_TYPES,
  SPACE_TYPE_DESCRIPTIONS,
  SPACE_TYPE_LABELS,
  type SpaceType,
} from '@play/types';
import { useCreateSpace, useUploadSpaceThumbnail } from '@api/modules/space/space.queries';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Textarea } from '@ui/components/ui/textarea';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MIN_DRIP_INTERVAL_DAYS = 1;
const MAX_DRIP_INTERVAL_DAYS = 365;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

/** The colour input's shared value shape: a `#rrggbb` string, or none at all. */
type ColorChoice = string | null;

function ColorSwatch({
  color,
  selected,
  onSelect,
  label,
}: {
  color: ColorChoice;
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={cn(
        'flex size-8 items-center justify-center rounded-full border transition-all',
        selected ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : 'hover:scale-105',
        !color && 'border-dashed',
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {selected && <CheckIcon className={cn('size-4', color ? 'text-white' : 'text-foreground')} />}
    </button>
  );
}

/**
 * Creates a space (course): what it is called, how it unfolds, what colour it
 * wears, and an optional cover image.
 *
 * The cover is uploaded straight to S3 after the space exists, because the
 * presigned URL is issued against a space id. A cover that fails to upload
 * therefore does not fail the space itself.
 */
export function SpaceForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<SpaceType>('SELF_PACED');
  /** A `yyyy-mm-dd` value straight from the date input. */
  const [startDate, setStartDate] = useState('');
  const [dripIntervalDays, setDripIntervalDays] = useState(String(DEFAULT_DRIP_INTERVAL_DAYS));
  const [color, setColor] = useState<ColorChoice>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = useCreateSpace(orgId);
  const uploadCover = useUploadSpaceThumbnail();
  const submitting = create.isPending || uploadCover.isPending;
  const scheduled = type === 'SCHEDULED';

  // The preview is an object URL, so it has to be handed back when it is
  // replaced or the form goes away.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const trimmedTitle = title.trim();
  const tooShort = trimmedTitle.length > 0 && trimmedTitle.length < MIN_TITLE_LENGTH;
  const drip = Number(dripIntervalDays);
  const dripValid =
    Number.isInteger(drip) && drip >= MIN_DRIP_INTERVAL_DAYS && drip <= MAX_DRIP_INTERVAL_DAYS;
  const canSubmit = trimmedTitle.length >= MIN_TITLE_LENGTH && (!scheduled || Boolean(startDate) && dripValid);

  function handleFile(selected: File | null | undefined) {
    if (!selected) {
      setFile(null);
      return;
    }
    if (!selected.type.startsWith('image/')) {
      toast.error('Choose an image file for the cover');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (selected.size > MAX_THUMBNAIL_BYTES) {
      toast.error('Cover images must be 5 MB or smaller');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setFile(selected);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!trimmedTitle) {
      setError('Title is required');
      return;
    }
    if (trimmedTitle.length < MIN_TITLE_LENGTH) {
      setError(`Title must be at least ${MIN_TITLE_LENGTH} characters`);
      return;
    }
    if (scheduled && !startDate) {
      setError('Pick the date this space starts');
      return;
    }
    if (scheduled && !dripValid) {
      setError(
        `Sections must unlock every ${MIN_DRIP_INTERVAL_DAYS}–${MAX_DRIP_INTERVAL_DAYS} days`,
      );
      return;
    }

    let spaceId: string;
    let spaceTitle: string;
    try {
      const { space } = await create.mutateAsync({
        title: trimmedTitle,
        description: description.trim(),
        type,
        ...(color ? { color } : {}),
        // A self-paced space has no schedule to send: its clock is enrollment.
        ...(scheduled ? { startAt: startDate, dripIntervalDays: drip } : {}),
      });
      spaceId = space.spaceId;
      spaceTitle = space.title;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create the space';
      setError(message);
      toast.error(message);
      return;
    }

    if (file) {
      try {
        const reserved = await uploadCover.mutateAsync({
          spaceId,
          contentType: file.type,
          size: file.size,
        });
        await putFileToPresignedUrl(file, reserved.upload);
      } catch (err) {
        // The space is already created and usable — losing the cover is a
        // warning, not a failure, and saying so beats a silent gap.
        toast.warning(
          `Space created, but the cover did not upload: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }

    toast.success(`${spaceTitle} created`);
    router.push(`/o/${orgId}/spaces/${spaceId}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="space-title">Title</Label>
          <Input
            id="space-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Introduction to Film"
            maxLength={MAX_TITLE_LENGTH}
            autoFocus
          />
          {tooShort ? (
            <p className="text-xs text-destructive">
              Title must be at least {MIN_TITLE_LENGTH} characters
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {MAX_TITLE_LENGTH} characters max
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="space-description">Description</Label>
          <Textarea
            id="space-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this space covers, and who it is for (optional)"
            maxLength={MAX_DESCRIPTION_LENGTH}
            rows={3}
          />
        </div>
      </div>

      <fieldset className="grid gap-3">
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
            />
            <p className="text-xs text-muted-foreground">
              Section 1 unlocks on this day.
            </p>
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
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Measured from the start date, not from enrollment.
            </p>
          </div>
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
          />
          {SPACE_COLORS.map((option) => (
            <ColorSwatch
              key={option}
              color={option}
              selected={color === option}
              onSelect={() => setColor(option)}
              label={option}
            />
          ))}
          <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="color"
              value={color ?? '#6366f1'}
              onChange={(e) => setColor(e.target.value)}
              className="size-8 cursor-pointer rounded-full border bg-transparent p-0.5"
            />
            Custom
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Colour is what the space is recognised by in the sidebar and its cover. Leave it
          unset and one is derived from the space&apos;s id.
        </p>
      </div>

      <div className="grid gap-3">
        <Label htmlFor="space-cover">Cover image</Label>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative aspect-video w-40 overflow-hidden rounded-xl border bg-muted/40">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Cover preview" className="absolute inset-0 size-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <ImageIcon className="size-6" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              id="space-cover"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <ImageIcon />
                {file ? 'Choose another' : 'Choose image'}
              </Button>
              {file && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                >
                  <XIcon />
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Optional. JPEG or PNG, up to 5 MB — shown as the space&apos;s cover.
            </p>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.push(`/o/${orgId}/spaces`)}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !canSubmit}>
          {submitting ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
          {create.isPending
            ? 'Creating…'
            : uploadCover.isPending
              ? 'Uploading cover…'
              : 'Create space'}
        </Button>
      </div>
    </form>
  );
}
