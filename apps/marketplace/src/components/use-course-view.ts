'use client';

import { useMemo } from 'react';
import {
  ApiError,
  useCatalogCourse,
  useSections,
  useSpace,
  useSpaceInstructors,
} from '@play/api';
import { useIsSignedIn } from '@play/auth';
import { useEnrollment } from '@/components/use-enrolled';
import type { CatalogCourse, CatalogSection, PublicInstructor } from '@play/types';

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
 *
 * Who teaches it follows the same split for the same reason: the catalog carries
 * the names with the course for anybody, and a member of an unlisted course asks
 * the course's own endpoint, which they are allowed to read because they are in
 * it. A course page credits somebody either way.
 */
export function useCourseView(spaceId: string): {
  course?: CatalogCourse;
  sections: CatalogSection[];
  instructors: PublicInstructor[];
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
  const memberInstructors = useSpaceInstructors(spaceId, useMemberView);

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
      // `?? []` because the two halves of this product deploy separately: a
      // marketplace built after the field was added can be serving a course from
      // an API that predates it, and a course page must not fall over on a field
      // that arrived after the page did.
      instructors: catalog.data.instructors ?? [],
      isLoading: false,
      notFound: false,
      error: undefined,
    };
  }

  if (useMemberView) {
    return {
      course: memberView?.course,
      sections: memberView?.sections ?? [],
      instructors: memberInstructors.data?.instructors ?? [],
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
    instructors: [],
    isLoading: stillResolving,
    notFound: catalogMissing && !useMemberView,
    error: catalog.isError && !catalogMissing ? catalog.error : undefined,
  };
}
