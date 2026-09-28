'use client';

import { useParams } from 'next/navigation';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useSession } from '@/lib/oauth/session';
import { Classroom } from '@/components/classroom/classroom';
import { ConnectPrompt } from '@/components/connect-prompt';

/**
 * A course, as this app reads it.
 *
 * The route is the app's own — `localhost:4000/courses/{spaceId}` — and nothing
 * about it is Play's. A course is addressed by the same id everywhere, which is
 * the only thing the two apps share: Play's URLs are its business, and a
 * third-party app that linked into them would be a third-party app that breaks
 * when a screen moves.
 */
export default function CoursePage() {
  const params = useParams<{ spaceId: string }>();
  const { ready, signedIn } = useSession();
  const spaceId = typeof params?.spaceId === 'string' ? params.spaceId : '';

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <Skeleton className="h-8 w-72" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[18rem_1fr]">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="aspect-video w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-12">
        <ConnectPrompt what="this course" />
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-12">
        <p className="text-sm text-muted-foreground">That course id is not usable.</p>
      </div>
    );
  }

  return <Classroom spaceId={spaceId} />;
}
