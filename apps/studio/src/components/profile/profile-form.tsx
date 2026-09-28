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
import {
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_LINK_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_MIN_LENGTH,
  SOCIAL_KEYS,
  SOCIAL_LABELS,
  SOCIAL_PLACEHOLDERS,
  type ProfileSocials,
  type SocialKey,
} from '@play/types';
import { PersonAvatar } from '@play/ui';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Skeleton } from '@ui/components/ui/skeleton';
import { Textarea } from '@ui/components/ui/textarea';
import { BlockLabel } from '@/components/shell/page-card';

/** Mirrors the API's own ceiling, so a large file fails here rather than over the wire. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** The five links, always as strings: an empty field is how one is removed. */
type LinkFields = Record<SocialKey, string>;

const NO_LINKS: LinkFields = {
  website: '',
  x: '',
  linkedin: '',
  youtube: '',
  github: '',
};

/** What the form holds, as it holds it. */
interface FormState {
  name: string;
  bio: string;
  links: LinkFields;
}

function toFormState(profile: {
  name: string;
  bio: string;
  socials: ProfileSocials;
}): FormState {
  const links = { ...NO_LINKS };
  for (const key of SOCIAL_KEYS) {
    links[key] = profile.socials[key] ?? '';
  }
  return { name: profile.name, bio: profile.bio, links };
}

/**
 * The person's own screen: what they are called, what they look like, and what
 * they say about themselves.
 *
 * Deliberately not a settings form. There is nothing to configure and nothing to
 * switch on — three fields and a photo, all of which are read by somebody
 * deciding whether to take a course — and the page says so, because a person who
 * thinks of this as configuration will not bother filling it in.
 *
 * The photo is its own write and the fields are another, which is not an
 * accident of the API: a photo is a presigned upload that lands in S3 a moment
 * after the row points at it, and holding a name change behind an upload that is
 * still going would be a form that appears to hang.
 */
export function ProfileForm() {
  const profileQuery = useMyProfile();
  const update = useUpdateMyProfile();
  const upload = useUploadProfilePhoto();

  const { user } = useAuthenticator((context) => [context.user]);
  const email = user?.signInDetails?.loginId ?? user?.username ?? '';

  const profile = profileQuery.data?.profile;

  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** The bytes being uploaded, shown until the CDN can serve the real object. */
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The server's answer seeds the form, and only the first one does: a photo
  // upload also writes the profile, and a form that re-read itself on every
  // answer would throw away a name somebody was halfway through typing.
  useEffect(() => {
    if (!profile || form) return;
    const next = toFormState(profile);
    setForm(next);
    setSaved(next);
  }, [profile, form]);

  // Object URLs are a leak until they are revoked, and this one is replaced on
  // every upload.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  if (!form || !saved) {
    // A profile that could not be read is said out loud rather than left as a
    // skeleton: the screen has nothing to draw and a form that never arrives
    // reads as a page that is still loading something it is not.
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
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  const trimmedName = form.name.trim();
  const nameTooShort = trimmedName.length < PROFILE_NAME_MIN_LENGTH;
  const badLink = SOCIAL_KEYS.find(
    (key) => form.links[key].trim() !== '' && !isUrl(form.links[key].trim()),
  );

  const dirty =
    form.name !== saved.name ||
    form.bio !== saved.bio ||
    SOCIAL_KEYS.some((key) => form.links[key].trim() !== saved.links[key]);

  const canSave = dirty && !nameTooShort && !badLink;

  async function save() {
    if (!canSave || !form) return;
    setError(null);

    const socials: ProfileSocials = {};
    for (const key of SOCIAL_KEYS) {
      const value = form.links[key].trim();
      if (value) socials[key] = value;
    }

    try {
      const { profile: updated } = await update.mutateAsync({
        name: trimmedName,
        bio: form.bio.trim(),
        // Sent whole, including the ones just cleared: the API stores what it is
        // given and drops what is empty, so an emptied field is a removal rather
        // than an omission the server has to guess about.
        socials,
      });
      // What the API stored becomes the form's new baseline — including the
      // normalizing it did, so the field shows the name that was actually saved
      // and the button stops offering to save it again.
      const next = toFormState(updated);
      setForm(next);
      setSaved(next);
      toast.success('Profile saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your profile';
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

    // Shown until the upload lands: the profile already points at the new object,
    // and CloudFront cannot serve it for the half second it is still in flight.
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
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <BlockLabel>Photo</BlockLabel>
        <div className="flex items-center gap-4">
          <PersonAvatar
            name={trimmedName || 'Your profile'}
            photoUrl={preview ?? profile?.photoUrl}
            size="xl"
            className={uploading ? 'opacity-60' : undefined}
          />
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                id="profile-photo"
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
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2Icon className="animate-spin" /> : <ImageIcon />}
                {uploading ? 'Uploading…' : profile?.photoKey ? 'Replace photo' : 'Upload photo'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A square image works best. Learners see it beside your name.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <BlockLabel>About you</BlockLabel>

        <div className="grid gap-2">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            maxLength={PROFILE_NAME_MAX_LENGTH}
            placeholder="Anna Ruiz"
          />
          {nameTooShort ? (
            <p className="text-xs text-destructive">
              A name of at least {PROFILE_NAME_MIN_LENGTH} characters
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {email ? `Signed in as ${email}. This is the name courses you teach are credited to.` : 'This is the name courses you teach are credited to.'}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="profile-bio">Description</Label>
          <Textarea
            id="profile-bio"
            value={form.bio}
            onChange={(event) => setForm({ ...form, bio: event.target.value })}
            rows={4}
            maxLength={PROFILE_BIO_MAX_LENGTH}
            placeholder="What you teach, how you got here, and who your courses are for."
          />
          <p className="text-xs text-muted-foreground">
            {form.bio.length}/{PROFILE_BIO_MAX_LENGTH} characters
          </p>
        </div>
      </section>

      <section className="grid gap-4">
        <BlockLabel>Links</BlockLabel>
        <p className="-mt-2 text-xs text-muted-foreground">
          Only the ones you fill in are shown. Each has to be a whole address, starting with
          https://
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {SOCIAL_KEYS.map((key) => (
            <div key={key} className="grid gap-2">
              <Label htmlFor={`profile-link-${key}`}>{SOCIAL_LABELS[key]}</Label>
              <Input
                id={`profile-link-${key}`}
                value={form.links[key]}
                onChange={(event) =>
                  setForm({ ...form, links: { ...form.links, [key]: event.target.value } })
                }
                maxLength={PROFILE_LINK_MAX_LENGTH}
                placeholder={SOCIAL_PLACEHOLDERS[key]}
                inputMode="url"
                autoComplete="off"
                aria-invalid={badLink === key || undefined}
              />
              {badLink === key && (
                <p className="text-xs text-destructive">
                  A whole address, e.g. {SOCIAL_PLACEHOLDERS[key]}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || update.isPending}
          onClick={() => setForm(saved)}
        >
          Reset
        </Button>
        <Button type="button" onClick={() => void save()} disabled={!canSave || update.isPending}>
          {update.isPending ? <Loader2Icon className="animate-spin" /> : null}
          {update.isPending ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </div>
  );
}

/** A whole address or nothing: the API refuses a bare host, and so does this. */
function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
