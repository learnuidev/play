'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LockIcon, SignpostIcon } from 'lucide-react';
import { Classroom } from '@play/learning';
import { useIsSignedIn } from '@play/auth';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useEnrollment } from '@/components/use-enrolled';
import { marketplaceLearningRoutes } from '@/lib/routes';

/**
 * A lesson, for somebody taking the course.
 *
 * The lesson itself is the shared classroom — the same player, transcript,
 * notes, files and discussion the studio shows its authors — and everything
 * around it here is the marketplace's: which URLs its outline links to, and who
 * is allowed in.
 *
 * `canEdit` is absent on purpose. A learner reads a lesson; the authoring
 * controls belong to the studio, where the person looking at them is the person
 * who wrote the course.
 */
export default function LessonPage() {
  const { spaceId, contentId } = useParams<{ spaceId: string; contentId: string }>();
  const signedIn = useIsSignedIn();
  const { enrolled, isLoading } = useEnrollment(spaceId);

  const coursePath = `/courses/${spaceId}`;

  if (!signedIn) {
    return (
      <Gate
        icon={<SignpostIcon className="size-5 text-muted-foreground/60" />}
        title="Sign in to take this course"
        description="Lessons are for the people registered for a course. Sign in and you will come straight back to this one."
      >
        <Button asChild>
          <Link href={`/sign-in?next=${encodeURIComponent(`${coursePath}/lessons/${contentId}`)}`}>
            Sign in
          </Link>
        </Button>
      </Gate>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="h-8 w-64" />
      </div>
    );
  }

  if (!enrolled) {
    return (
      <Gate
        icon={<LockIcon className="size-5 text-muted-foreground/60" />}
        title="Register to open this lesson"
        description="You can read the whole course outline without registering — the lessons themselves open once you are in."
      >
        <Button asChild>
          <Link href={coursePath}>See the course</Link>
        </Button>
      </Gate>
    );
  }

  return <Classroom spaceId={spaceId} contentId={contentId} routes={marketplaceLearningRoutes} />;
}

/** What a lesson page shows instead of a lesson, to somebody who cannot open it. */
function Gate({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-3 text-center">
      {icon}
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
