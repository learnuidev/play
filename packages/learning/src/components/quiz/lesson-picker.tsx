'use client';

import { useState } from 'react';
import { Label } from '@ui/components/ui/label';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useSpaces } from '@api/modules/space/space.queries';
import { useSections } from '@api/modules/section/section.queries';

/**
 * Which lesson a question is about — the one field every question has to have.
 *
 * Two selects rather than one: the courses an organization has, and the lessons
 * of the one chosen. There is no endpoint that lists every lesson in an
 * organization, and inventing one to fill a dropdown would mean a read that
 * walks every course — while the two steps are how somebody thinks about it
 * anyway ("the biology course… lesson three").
 *
 * When the space is already known, which is the case on a quiz's own page, the
 * course select is dropped and the lesson list is that course's.
 */
export function LessonPicker({
  orgId,
  spaceId,
  value,
  onChange,
  disabled,
}: {
  orgId: string;
  /** The course whose lessons are on offer. Omit to let the author choose one. */
  spaceId?: string;
  /** The lesson chosen, or `''`. */
  value: string;
  onChange: (lessonContentId: string) => void;
  disabled?: boolean;
}) {
  const { data: spacesData, isLoading: spacesLoading } = useSpaces(orgId);
  const [pickedSpaceId, setPickedSpaceId] = useState('');

  const spaces = spacesData?.spaces ?? [];
  const effectiveSpaceId = spaceId ?? pickedSpaceId;

  const { data: outline, isLoading: outlineLoading } = useSections(effectiveSpaceId);

  const lessons = (outline?.sections ?? []).flatMap((section) =>
    section.contents
      .filter((content) => content.type === 'VIDEO')
      .map((content) => ({
        contentId: content.contentId,
        title: content.title,
        sectionTitle: section.title,
      })),
  );

  return (
    <div className="grid gap-3">
      {!spaceId && (
        <div className="grid gap-2">
          <Label htmlFor="lesson-course">Course</Label>
          {spacesLoading ? (
            <Skeleton className="h-9 w-full rounded-md" />
          ) : spaces.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This organization has no courses yet. A question is about a lesson, so there has to be
              a course with lessons in it first.
            </p>
          ) : (
            <select
              id="lesson-course"
              value={pickedSpaceId}
              disabled={disabled}
              onChange={(event) => {
                setPickedSpaceId(event.target.value);
                // The lesson belonged to the course that was chosen, so it stops
                // being an answer the moment the course changes.
                onChange('');
              }}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
            >
              <option value="">Choose a course</option>
              {spaces.map((space) => (
                <option key={space.spaceId} value={space.spaceId}>
                  {space.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="lesson-content">Lesson</Label>
        {!effectiveSpaceId ? (
          <p className="text-xs text-muted-foreground">
            Choose a course first — a question is about one of its lessons.
          </p>
        ) : outlineLoading ? (
          <Skeleton className="h-9 w-full rounded-md" />
        ) : lessons.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This course has no lessons yet, and a question is about a lesson.
          </p>
        ) : (
          <select
            id="lesson-content"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            <option value="">Choose a lesson</option>
            {lessons.map((lesson) => (
              <option key={lesson.contentId} value={lesson.contentId}>
                {lesson.title} — {lesson.sectionTitle}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
