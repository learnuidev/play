'use client';

/**
 * How far through a course somebody is: the count, the percentage, and the bar
 * that carries the two.
 *
 * Drawn by both places the marketplace says how much of a course is left — the
 * card in "my learning" and the course page's own panel — because they are the
 * same statement in two sizes, and two of them would eventually round
 * differently.
 *
 * A course with nothing published draws nothing: "0 of 0 lessons" is not a
 * progress report, it is a course with no lessons, and saying so is the syllabus'
 * job rather than this bar's.
 */
export function CourseProgress({
  completedCount,
  lessonCount,
}: {
  completedCount: number;
  lessonCount: number;
}) {
  if (lessonCount === 0) return null;

  const percent = Math.round((completedCount / lessonCount) * 100);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {completedCount} of {lessonCount} lesson{lessonCount === 1 ? '' : 's'} complete
        </span>
        <span className="font-medium tabular-nums text-foreground">{percent}%</span>
      </div>

      <div
        role="progressbar"
        aria-label="Course progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
