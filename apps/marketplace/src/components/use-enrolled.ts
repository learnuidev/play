'use client';

import { useMemo } from 'react';
import { useIsSignedIn } from '@play/auth';
import { useMyCourses } from '@play/api';

/**
 * Which courses the reader is already taking.
 *
 * The courses they are in are read once and answered as a set of ids, because
 * that is what a list asks of it — "is this one of mine?" — per card.
 *
 * Signed out it is empty and no request goes out: "the courses I am in" is a
 * question that needs an account, and a front page must not open with a 401
 * behind it.
 */
export function useEnrolledSpaceIds(): Set<string> {
  const signedIn = useIsSignedIn();
  const { data } = useMyCourses(signedIn);
  const courses = data?.courses;

  return useMemo(() => new Set((courses ?? []).map((course) => course.space.spaceId)), [courses]);
}

/**
 * Whether one course is one of them, and whether that is known yet.
 *
 * The two are one answer because they are read together: a lesson page that
 * treated "not yet loaded" as "not registered" would flash a register button at
 * somebody who is already in the course.
 *
 * `purchasedAt` is the same read answering a second question — whether this
 * enrolment was *bought* or given. A purchase cannot be left, only refunded, and
 * the course page has to know which of the two it is looking at before it offers
 * either. It is the paid payment's own `paidAt`, so the page, the refund window
 * and the receipt all read one moment.
 */
export function useEnrollment(spaceId: string): {
  enrolled: boolean;
  isLoading: boolean;
  purchasedAt?: number;
} {
  const signedIn = useIsSignedIn();
  const { data, isLoading } = useMyCourses(signedIn);
  const courses = data?.courses;

  return useMemo(() => {
    const mine = (courses ?? []).find((course) => course.space.spaceId === spaceId);
    return {
      enrolled: Boolean(mine),
      // Nothing is being asked of the API when nobody is signed in, so there is
      // nothing to wait for either.
      isLoading: signedIn && isLoading,
      ...(mine?.purchasedAt ? { purchasedAt: mine.purchasedAt } : {}),
    };
  }, [courses, isLoading, signedIn, spaceId]);
}
