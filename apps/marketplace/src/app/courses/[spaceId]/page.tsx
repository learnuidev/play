'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  BookOpenIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CirclePlayIcon,
  Loader2Icon,
  LockIcon,
  UsersIcon,
} from 'lucide-react';
import { useEnrollInCourse, useLeaveCourse } from '@play/api';
import { useIsSignedIn } from '@play/auth';
import { SpaceAvatar, spaceAccentColor } from '@learning/components/space/space-avatar';
import { SpaceTypeBadge } from '@learning/components/space/space-type-badge';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { formatDate } from '@ui/lib/utils';
import { useEnrollment } from '@/components/use-enrolled';
import { useCourseView } from '@/components/use-course-view';
import type { CatalogCourse, CatalogSection } from '@play/types';

/**
 * A course, from the outside: what it is, what it covers, and the button that
 * starts it.
 *
 * The syllabus is public — sections and lesson titles, which is what somebody
 * weighs a course by — while the lessons themselves open only once they are
 * registered. That is the whole shape of a marketplace: read enough to decide,
 * sign in and register to take it.
 */
export default function CoursePage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const { course, sections, isLoading, notFound, error } = useCourseView(spaceId);

  if (error) {
    return (
      <p className="mx-auto w-full max-w-6xl px-4 py-12 text-sm text-destructive">
        {error instanceof Error ? error.message : 'Could not load this course'}
      </p>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-4 py-24 text-center">
        <p className="text-sm font-medium">This course is not in the marketplace</p>
        <p className="max-w-md text-sm text-muted-foreground">
          It may have been unpublished by whoever wrote it, or the link may be wrong.
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link href="/">Browse the catalog</Link>
        </Button>
      </div>
    );
  }

  if (isLoading || !course) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12">
        <Skeleton className="aspect-[3/1] w-full rounded-3xl" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  // The lesson the register button opens: the first one that can actually be
  // played, which is what somebody arriving at a classroom wants to see. A
  // course whose first lesson is unwritten still opens on it rather than
  // nowhere.
  const firstLessonId =
    sections.flatMap((section) => section.lessons).find((lesson) => lesson.hasVideo)?.contentId ??
    sections.flatMap((section) => section.lessons)[0]?.contentId;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-6">
        <CourseCover course={course} />
        <CourseHeader course={course} />
        <Syllabus sections={sections} />
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <RegisterPanel
          spaceId={spaceId}
          courseTitle={course.title}
          lessonCount={course.lessonCount}
          firstLessonId={firstLessonId}
        >
          <dl className="grid grid-cols-2 gap-3">
            <Stat icon={<UsersIcon className="size-3.5" />} label="Learning" value={course.studentCount} />
            <Stat icon={<BookOpenIcon className="size-3.5" />} label="Lessons" value={course.lessonCount} />
          </dl>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            {course.type === 'SCHEDULED' ? (
              <CalendarClockIcon className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <CirclePlayIcon className="mt-0.5 size-3.5 shrink-0" />
            )}
            {course.type === 'SCHEDULED' && course.startAt
              ? `Starts ${formatDate(course.startAt)}${
                  course.dripIntervalDays
                    ? `, a section every ${course.dripIntervalDays} day${course.dripIntervalDays === 1 ? '' : 's'}`
                    : ''
                }.`
              : 'Self-paced: start whenever you register, and go at your own speed.'}
          </p>
        </RegisterPanel>
      </aside>
    </div>
  );
}

/** The course's banner: its own cover, or the accent colour it is drawn in. */
function CourseCover({ course }: { course: CatalogCourse }) {
  const accent = spaceAccentColor(course);

  return (
    <div className="relative aspect-[3/1] w-full overflow-hidden rounded-2xl border">
      {course.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={course.thumbnailUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center text-5xl font-semibold text-white/90"
          style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}66 100%)` }}
        >
          {course.title.trim()[0]?.toUpperCase() ?? '?'}
        </div>
      )}
    </div>
  );
}

function CourseHeader({ course }: { course: CatalogCourse }) {
  return (
    <header className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SpaceTypeBadge type={course.type} />
        <span className="text-xs text-muted-foreground">from {course.organizationName}</span>
      </div>

      <div className="flex items-start gap-3">
        <SpaceAvatar space={course} size="lg" className="mt-0.5" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {course.title}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {course.description || 'This course has not been described yet.'}
          </p>
        </div>
      </div>
    </header>
  );
}

/** What the course covers: its sections, and the lessons under each. */
function Syllabus({ sections }: { sections: CatalogSection[] }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        What it covers
      </h2>

      {sections.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-muted/20 px-5 py-8 text-center text-sm text-muted-foreground">
          This course has no lessons published yet.
        </p>
      ) : (
        <ol className="grid gap-3">
          {sections.map((section, index) => (
            <li key={section.sectionId} className="overflow-hidden rounded-2xl border bg-card">
              <div className="flex items-baseline gap-2.5 border-b bg-muted/30 px-4 py-3">
                <span className="text-xs font-medium tabular-nums text-muted-foreground/60">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-sm font-semibold">{section.title}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {section.lessons.length} lesson{section.lessons.length === 1 ? '' : 's'}
                </span>
              </div>

              {section.lessons.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nothing published yet.</p>
              ) : (
                <ul className="divide-y">
                  {section.lessons.map((lesson) => (
                    <li key={lesson.contentId} className="flex items-center gap-2.5 px-4 py-2.5">
                      {lesson.hasVideo ? (
                        <CirclePlayIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                      ) : (
                        <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                      )}
                      <span className="truncate text-sm">{lesson.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Registering, and the state of the reader's relationship to the course.
 *
 * Registering is also where the marketplace asks who somebody is — browsing
 * never does — so an anonymous reader is sent to sign in and straight back here,
 * with the course still under them.
 */
function RegisterPanel({
  spaceId,
  courseTitle,
  lessonCount,
  firstLessonId,
  children,
}: {
  spaceId: string;
  courseTitle: string;
  lessonCount: number;
  firstLessonId?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const signedIn = useIsSignedIn();
  const enroll = useEnrollInCourse(spaceId);
  const leave = useLeaveCourse(spaceId);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const { enrolled } = useEnrollment(spaceId);
  const coursePath = `/courses/${spaceId}`;

  async function register() {
    if (!signedIn) {
      router.push(`/sign-in?next=${encodeURIComponent(coursePath)}`);
      return;
    }

    try {
      await enroll.mutateAsync();
      toast.success('You are registered', {
        description: `${courseTitle} is now in your learning.`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not register for this course');
    }
  }

  async function unregister() {
    try {
      await leave.mutateAsync();
      setConfirmingLeave(false);
      toast.success('You have left this course');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not leave this course');
    }
  }

  return (
    <div className="grid gap-4 rounded-2xl border bg-card p-5">
      {enrolled ? (
        <>
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2Icon className="size-4" />
            You are registered
          </p>
          {firstLessonId ? (
            <Button asChild className="w-full">
              <Link href={`${coursePath}/lessons/${firstLessonId}`}>Open the classroom</Link>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              This course has no lessons published yet — there is nothing to open.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <LockIcon className="size-3.5" />
            Register to open the {lessonCount} lesson{lessonCount === 1 ? '' : 's'}
          </p>
          <Button className="w-full gap-1.5" onClick={() => void register()} disabled={enroll.isPending}>
            {enroll.isPending && <Loader2Icon className="animate-spin" />}
            {enroll.isPending
              ? 'Registering…'
              : signedIn
                ? 'Register for this course'
                : 'Sign in to register'}
          </Button>
        </>
      )}

      {children}

      {enrolled && (
        <div className="border-t pt-3">
          {confirmingLeave ? (
            <div className="grid gap-2">
              <p className="text-xs text-muted-foreground">
                Leaving removes the course from your learning. Your progress is kept if you register
                again.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setConfirmingLeave(false)}
                >
                  Keep it
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => void unregister()}
                  disabled={leave.isPending}
                >
                  {leave.isPending ? <Loader2Icon className="animate-spin" /> : null}
                  Leave
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => setConfirmingLeave(true)}
            >
              Leave this course
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-semibold tabular-nums">{value}</dd>
      </div>
    </div>
  );
}
