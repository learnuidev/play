'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2Icon, MailCheckIcon } from 'lucide-react';
import { useAcceptSpaceInvitation, useCatalogCourse, useMySpaceInvitations } from '@play/api';
import { SignIn, rememberAfterSignIn, useAuthStatus } from '@play/auth';
import { PlayMark } from '@play/ui';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useEnrollment } from '@/components/use-enrolled';
import { SPACE_MEMBER_ROLE_LABELS, type MySpaceInvitation } from '@play/types';

/**
 * Where a course invitation is claimed.
 *
 * This is the page the link in the invitation email opens, and it replaced the
 * studio's course page as that destination. An invitation is an offer to *take* a
 * course, and the studio is where courses are written: somebody invited from
 * outside the organization arrived there at a rail of authoring screens they
 * cannot use, on a course they could not read yet. The marketplace is the app
 * courses are taken in, and this is the one page in it that knows what is being
 * asked of the reader.
 *
 * It is two pages in one, because the person an invitation is addressed to either
 * has an account or does not:
 *
 * - **Signed out**, it is the shared sign-in screen, with the headline saying
 *   what is being joined rather than asking a stranger to "make an account" as
 *   though they had wandered in. The mark and the form are `@play/auth`'s; the
 *   only thing this page decides is what to call the thing being joined.
 * - **Signed in**, it is the offer itself — the same column, the same mark, and
 *   the one button that makes the course theirs.
 *
 * Nothing here is a token. An invitation names an email address, and being signed
 * in as that address is the whole of what accepting it means, which is why the
 * page can be a public URL and still give nothing away.
 */
export default function JoinCoursePage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const status = useAuthStatus();
  const signedIn = status === 'authenticated';

  /**
   * What is being joined, for somebody who cannot be told yet.
   *
   * The invitation itself is the caller's own, and there is no caller until they
   * have signed in — so before that the only thing that can name the course is
   * the public catalog, which serves every *listed* course to anybody who asks.
   * A course nobody listed names nothing, and the headline says "Join Play"
   * rather than inventing a name out of a URL somebody could have typed.
   *
   * Asked for only while signed out: once the invitation can be read, it is a
   * better answer than the catalog's, and the catalog's would be a request for
   * something already on the page.
   */
  const catalog = useCatalogCourse(signedIn ? '' : spaceId);

  /**
   * Where this round trip was for, for the way in that leaves the page.
   *
   * Signing up with a password never leaves `/join`, so the page is still here to
   * carry on with when it is done. Signing up with Google does: the browser goes
   * to the Cognito Hosted UI and comes back to `/auth/callback`, which has no
   * `?next=` and no idea an invitation was ever involved. The note is what
   * survives that — without it somebody who chose Google lands on the front page
   * with the course they were invited to nowhere in sight.
   */
  useEffect(() => {
    rememberAfterSignIn(`/join/${encodeURIComponent(spaceId)}`);
  }, [spaceId]);

  if (status === 'configuring') {
    return (
      <Screen>
        <Skeleton className="h-80 w-full rounded-3xl" />
      </Screen>
    );
  }

  if (!signedIn) {
    return (
      <SignIn
        invitation={{
          name: catalog.data?.course.organizationName ?? 'Play',
          ...(catalog.data ? { detail: `You were invited to ${catalog.data.course.title}.` } : {}),
        }}
      />
    );
  }

  return <ClaimInvitation spaceId={spaceId} />;
}

/**
 * The offer, for somebody who is signed in.
 *
 * Three answers rather than two, because "there is no invitation here for you" is
 * not the same as "you are already in this course": the second is what the page
 * says to somebody who accepted it a week ago and clicked the email again, and
 * telling them the invitation is not theirs would be plainly wrong.
 */
function ClaimInvitation({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const invitations = useMySpaceInvitations();
  const { enrolled, isLoading: enrollmentLoading } = useEnrollment(spaceId);
  const accept = useAcceptSpaceInvitation(spaceId);

  const invitation = invitations.data?.invitations.find((one) => one.spaceId === spaceId);
  const coursePath = `/courses/${spaceId}`;

  async function handleAccept(offer: MySpaceInvitation) {
    try {
      await accept.mutateAsync();
      toast.success(`You have joined ${offer.spaceTitle}`);
      router.replace(coursePath);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not accept the invitation');
    }
  }

  if (invitations.isLoading || enrollmentLoading) {
    return (
      <Screen>
        <Skeleton className="h-56 w-full rounded-3xl" />
      </Screen>
    );
  }

  if (invitation) {
    return (
      <Screen>
        <PlayMark className="mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight">
          Join {invitation.organizationName}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          You were invited to {invitation.spaceTitle} as{' '}
          {SPACE_MEMBER_ROLE_LABELS[invitation.role].toLowerCase()}. The course is yours to read
          once you accept.
        </p>

        <Button
          className="mt-6 w-full"
          onClick={() => void handleAccept(invitation)}
          disabled={accept.isPending}
        >
          {accept.isPending && <Loader2Icon className="animate-spin" />}
          Accept invitation
        </Button>
      </Screen>
    );
  }

  if (enrolled) {
    return (
      <Screen>
        <PlayMark className="mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight">You are already in this course</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Nothing is waiting to be accepted — the invitation was taken up already, and the course
          is in your learning.
        </p>

        <Button className="mt-6 w-full" asChild>
          <Link href={coursePath}>Open the course</Link>
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <span className="mb-5 inline-flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <MailCheckIcon className="size-5" aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">
        This invitation is not for this account
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        An invitation is claimed by the email address it was sent to. Sign in as that address — sign
        out from the menu in the bar if you are signed in as another one — or ask whoever invited
        you to send another.
      </p>

      <Button className="mt-6 w-full" variant="outline" asChild>
        <Link href="/discover">Discover courses</Link>
      </Button>
    </Screen>
  );
}

/**
 * The column the sign-in screen draws, so this page is the same page either way.
 *
 * A windowful with the offer in the middle of it, and the padding around it is
 * the sign-in screen's own: this route keeps the app's bar pinned over the top of
 * it rather than taking a slice of the window, and the room at the top is what
 * keeps the mark clear of that bar on a short window.
 */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center px-5 py-14">
      <div className="flex w-full max-w-[26.25rem] flex-col items-center text-center">{children}</div>
    </div>
  );
}
