'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { ImageIcon, Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { putFileToPresignedUrl } from '@api/lib/upload';
import {
  useMyProfile,
  useUpdateMyProfile,
  useUploadProfilePhoto,
} from '@api/modules/profile/profile.queries';
import { PROFILE_NAME_MAX_LENGTH, PROFILE_NAME_MIN_LENGTH } from '@play/types';
import { PersonAvatar } from '@play/ui';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Skeleton } from '@ui/components/ui/skeleton';

/** Mirrors the API's own ceiling, so a large file fails here rather than over the wire. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * A learner's own name and face.
 *
 * Deliberately smaller than the studio's profile screen, and the difference is
 * who is reading it: an instructor's page is a claim about what they teach — a
 * description, a set of links — while a learner's is what appears beside their
 * name when they say something in a course or are greeted at the top of a page.
 * Two fields, both of which the marketplace has somewhere to show.
 *
 * The photo and the name are separate writes, and that is the API's shape rather
 * than this form's: a photo is a presigned upload that lands in S3 a moment after
 * the row points at it, so holding a name change behind an upload still in
 * flight would be a form that appears to hang.
 */
export function ProfileForm() {
  const profileQuery = useMyProfile();
  const update = useUpdateMyProfile();
  const upload = useUploadProfilePhoto();

  const { user } = useAuthenticator((context) => [context.user]);
  const email = user?.signInDetails?.loginId ?? user?.username ?? '';

  const profile = profileQuery.data?.profile;

  const [name, setName] = useState<string | null>(null);
  /** What the API last stored, so "unchanged" is a comparison rather than a guess. */
  const [savedName, setSavedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** The bytes being uploaded, shown until the CDN can serve the real object. */
  const [preview, setPreview] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  // The server's answer seeds the field, and only the first one does: a photo
  // upload also writes the profile, and a form that re-read itself on every
  // answer would throw away a name somebody was halfway through typing.
  useEffect(() => {
    if (!profile || name !== null) return;
    setName(profile.name);
    setSavedName(profile.name);
  }, [profile, name]);

  // Object URLs are a leak until they are revoked, and this one is replaced on
  // every upload.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  if (name === null || savedName === null) {
    if (profileQuery.isError) {
      return (
        <p className="text-sm text-destructive">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : 'Could not load your profile'}
        </p>
      );
    }

    return (
      <div className="grid gap-6">
        <Skeleton className="h-24 w-24 rounded-full" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    );
  }

  const trimmed = name.trim();
  const tooShort = trimmed.length < PROFILE_NAME_MIN_LENGTH;
  const dirty = trimmed !== savedName;

  async function save() {
    if (!dirty || tooShort) return;
    setError(null);

    try {
      const { profile: updated } = await update.mutateAsync({ name: trimmed });
      // What the API stored becomes the field's new baseline — including the
      // normalizing it did — so the button stops offering to save it again.
      setName(updated.name);
      setSavedName(updated.name);
      toast.success('Name saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your name';
      setError(message);
      toast.error(message);
    }
  }

  /**
   * A new photo, in the two halves every upload in this product has: the API
   * reserves the object and points the profile at it, and the bytes go from this
   * browser straight to S3.
   */
  async function changePhoto(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file for your photo');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('Photos must be 5 MB or smaller');
      return;
    }

    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const reserved = await upload.mutateAsync({ contentType: file.type, size: file.size });
      await putFileToPresignedUrl(file, reserved.upload);
      toast.success('Photo updated');
    } catch (err) {
      setPreview(null);
      toast.error(err instanceof Error ? err.message : 'Could not upload your photo');
    } finally {
      setUploading(false);
      // So re-picking the same file fires `change` again.
      if (photoRef.current) photoRef.current.value = '';
    }
  }

  return (
    <div className="grid gap-8 rounded-3xl border border-border/60 bg-card p-6">
      <section className="grid gap-3">
        <h2 className="text-base font-semibold tracking-tight">Photo</h2>
        <div className="flex items-center gap-4">
          <PersonAvatar
            name={trimmed || 'Your profile'}
            photoUrl={preview ?? profile?.photoUrl}
            size="xl"
            className={uploading ? 'opacity-60' : undefined}
          />
          <div className="grid gap-1">
            <input
              ref={photoRef}
              id="account-photo"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void changePhoto(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => photoRef.current?.click()}
            >
              {uploading ? <Loader2Icon className="animate-spin" /> : <ImageIcon />}
              {uploading ? 'Uploading…' : profile?.photoKey ? 'Replace photo' : 'Upload photo'}
            </Button>
            <p className="text-xs text-muted-foreground">
              A square image works best. It is what people see beside your name.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="text-base font-semibold tracking-tight">Name</h2>

        <div className="grid gap-2">
          <Label htmlFor="account-name">Your name</Label>
          <Input
            id="account-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={PROFILE_NAME_MAX_LENGTH}
            placeholder="Anna Ruiz"
          />
          {tooShort ? (
            <p className="text-xs text-destructive">
              A name of at least {PROFILE_NAME_MIN_LENGTH} characters
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {email
                ? `You sign in as ${email}. This is the name your account goes by here.`
                : 'This is the name your account goes by here.'}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || update.isPending}
            onClick={() => setName(savedName)}
          >
            Reset
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || tooShort || update.isPending}
          >
            {update.isPending ? <Loader2Icon className="animate-spin" /> : null}
            {update.isPending ? 'Saving…' : 'Save name'}
          </Button>
        </div>
      </section>
    </div>
  );
}
