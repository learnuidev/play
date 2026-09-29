'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LockIcon, SignpostIcon } from 'lucide-react';
import { Classroom } from '@play/learning';
import { useAuthStatus } from '@play/auth';
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
 * `layout="reader"` is the marketplace's half of a decision the classroom makes
 * once: a learner gets one screen with the video as the stage, a bar saying
 * where the lesson sits in the course, and the material a rail away; an author
 * in the studio gets the columns and the panel, because they are working on the
 * lesson rather than sitting it.
 *
 * `canEdit` is absent on purpose, for the same reason: a learner reads a lesson,
 * and the authoring controls belong to the studio, where the person looking at
 * them is the person who wrote the course.
 */
export default function LessonPage() {
  const { spaceId, contentId } = useParams<{ spaceId: string; contentId: string }>();
  const status = useAuthStatus();
  const { enrolled, isLoading } = useEnrollment(spaceId);

  const coursePath = `/courses/${spaceId}`;

  /**
   * Every reload starts here: the session is restored from storage after the
   * page is alive, so for a moment the answer to "is anybody signed in?" is not
   * yet — and a signed-in reader who is shown "Sign in to take this course" is
   * being told the wrong thing about themselves. Wait instead.
   */
  if (status === 'configuring' || (status === 'authenticated' && isLoading)) {
    return (
      <div className="grid gap-5 p-4 lg:px-6 lg:py-5">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="h-8 w-64" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
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

  return (
    <Classroom
      spaceId={spaceId}
      contentId={contentId}
      layout="reader"
      routes={marketplaceLearningRoutes}
    />
  );
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
    // It keeps its own measures because the frame no longer supplies them: a
    // lesson route is handed the window, and this is not the classroom.
    <div className="flex h-full min-h-[60svh] flex-col items-center justify-center gap-3 p-4 text-center lg:px-6 lg:py-5">
      {icon}
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
