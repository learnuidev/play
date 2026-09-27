'use client';

import { useMemo } from 'react';
import { ApiError, useCatalogCourse, useSections, useSpace } from '@play/api';
import { useIsSignedIn } from '@play/auth';
import { useEnrollment } from '@/components/use-enrolled';
import type { CatalogCourse, CatalogSection } from '@play/types';

/**
 * A course page's data, from whichever source is allowed to answer.
 *
 * A course usually comes from the catalog, which serves what its author
 * published to anybody who asks. But the catalog only knows *listed* courses,
 * and a course can be taken by somebody who was invited to it and whose author
 * never listed it — so for a reader who is already in the course, the member
 * endpoints are the fallback. The page is the same page either way; only where
 * the syllabus came from changes.
 *
 * The fallback is asked for only after the catalog has said 404 *and* the reader
 * is known to be enrolled, so a private course is not attempted for a stranger
 * and a listing mistake is not silently papered over.
 */
export function useCourseView(spaceId: string): {
  course?: CatalogCourse;
  sections: CatalogSection[];
  isLoading: boolean;
  /** True when there is no such course to show this reader at all. */
  notFound: boolean;
  error: unknown;
} {
  const signedIn = useIsSignedIn();
  const { enrolled, isLoading: enrollmentLoading } = useEnrollment(spaceId);

  const catalog = useCatalogCourse(spaceId);

  const catalogMissing =
    catalog.isError && catalog.error instanceof ApiError && catalog.error.status === 404;
  const useMemberView = signedIn && enrolled && catalogMissing;

  const space = useSpace(useMemberView ? spaceId : '');
  const outline = useSections(useMemberView ? spaceId : '');

  const memberView = useMemo(() => {
    const found = space.data?.space;
    const sections = outline.data?.sections;
    if (!found || !sections) return undefined;

    const lessons = sections.reduce((total, section) => total + section.contents.length, 0);

    return {
      // Counts a member's own course can answer without the catalog's three
      // queries: the outline they were just handed is the whole of it.
      course: {
        ...found,
        organizationName: 'Your course',
        sectionCount: sections.length,
        lessonCount: lessons,
        studentCount: 0,
      } satisfies CatalogCourse,
      sections: sections.map((section) => ({
        sectionId: section.sectionId,
        title: section.title,
        lessons: section.contents.map((content) => ({
          contentId: content.contentId,
          title: content.title,
          hasVideo: Boolean(content.videoId),
        })),
      })),
    };
  }, [outline.data, space.data]);

  if (catalog.data) {
    return {
      course: catalog.data.course,
      sections: catalog.data.sections,
      isLoading: false,
      notFound: false,
      error: undefined,
    };
  }

  if (useMemberView) {
    return {
      course: memberView?.course,
      sections: memberView?.sections ?? [],
      isLoading: !memberView,
      notFound: false,
      error: undefined,
    };
  }

  // Still deciding whether the catalog's 404 means "no such course" or "not
  // listed, and you are in it".
  const stillResolving = catalog.isLoading || enrollmentLoading;

  return {
    course: undefined,
    sections: [],
    isLoading: stillResolving,
    notFound: catalogMissing && !useMemberView,
    error: catalog.isError && !catalogMissing ? catalog.error : undefined,
  };
}
