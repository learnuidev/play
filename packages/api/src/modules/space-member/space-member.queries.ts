import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import type { SpaceMemberRole } from '@play/types';

export const spaceMemberKeys = {
  all: ['space-members'] as const,
  list: (spaceId: string) => ['space', spaceId, 'members'] as const,
  /** The roster read whole, for the screens that pick somebody out of it. */
  candidates: (spaceId: string) => ['space', spaceId, 'members', 'candidates'] as const,
  instructors: (spaceId: string) => ['space', spaceId, 'instructors'] as const,
  invitations: () => ['space-members', 'invitations'] as const,
  mine: () => ['space-members', 'mine'] as const,
};

/**
 * The courses the caller is in, across every organization.
 *
 * Read by the shell rather than by a page: a course can be taken by somebody who
 * belongs to no organization, and for them this is the only navigation there is.
 *
 * `enabled` exists for the marketplace, which renders for people who have not
 * signed in: asking this question anonymously is a 401, and a landing page must
 * not open with a failed request behind it.
 */
export function useMyCourses(enabled = true) {
  return useQuery({
    queryKey: spaceMemberKeys.mine(),
    queryFn: () => api.listMyCourses(),
    staleTime: 30 * 1000,
    enabled,
  });
}

/**
 * The course invitations addressed to the caller, across every organization.
 *
 * The one read somebody who belongs nowhere yet can make, and the only way an
 * invited person finds out they were invited to a course at all.
 */
export function useMySpaceInvitations() {
  return useQuery({
    queryKey: spaceMemberKeys.invitations(),
    queryFn: () => api.listMySpaceInvitations(),
    staleTime: 30 * 1000,
  });
}

/**
 * Who is in the course.
 *
 * A roster changes when somebody else acts on it — an instructor inviting while
 * a colleague removes — so it is not held for long.
 */
export function useSpaceMembers(spaceId: string) {
  return useQuery({
    queryKey: spaceMemberKeys.list(spaceId),
    queryFn: () => api.listSpaceMembers(spaceId),
    enabled: Boolean(spaceId),
    staleTime: 30 * 1000,
  });
}

/**
 * As much of a roster as the API will hand over in one page.
 *
 * Asked for by the screens that need *everybody* rather than a page — choosing
 * somebody to teach a course is not a choice between the first twenty members —
 * and it is the same ceiling the API enforces, so asking for more would only
 * waste a request.
 */
const ROSTER_PAGE_SIZE = 100;

/**
 * The roster as a list to choose from, rather than a page to read.
 *
 * Its own cache entry beside the roster's, because it is a different question:
 * the roster is what the Members tab draws, and this is everybody who could be
 * added to a course's staff. Sharing one entry would mean either the tab holds a
 * hundred-strong page it does not draw, or the picker silently offers the first
 * twenty people.
 *
 * `enabled` is what keeps it out of the way: the picker is a dialog, and nobody
 * should pay for this read until they open it.
 */
export function useSpaceMemberCandidates(spaceId: string, enabled = true) {
  return useQuery({
    queryKey: spaceMemberKeys.candidates(spaceId),
    queryFn: () => api.listSpaceMembers(spaceId, ROSTER_PAGE_SIZE),
    enabled: Boolean(spaceId) && enabled,
    staleTime: 30 * 1000,
  });
}

/**
 * Who teaches the course: the people it credits, with their names and faces.
 *
 * A different question from the roster above, and a much smaller one — the
 * roster is a page of everybody with their roles, this is the handful a course
 * page puts its name to. Read by the studio's course page and by the
 * marketplace, where an enrolled reader of an unlisted course cannot ask the
 * public catalog for it.
 *
 * Held longer than the roster: who teaches a course changes when an author
 * decides it does, not while somebody is reading the page.
 */
export function useSpaceInstructors(spaceId: string, enabled = true) {
  return useQuery({
    queryKey: spaceMemberKeys.instructors(spaceId),
    queryFn: () => api.listSpaceInstructors(spaceId),
    enabled: Boolean(spaceId) && enabled,
    staleTime: 60 * 1000,
  });
}

export function useInviteSpaceMember(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; role: SpaceMemberRole }) =>
      api.inviteSpaceMember(spaceId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: spaceMemberKeys.list(spaceId) });
      qc.invalidateQueries({ queryKey: spaceMemberKeys.instructors(spaceId) });
    },
  });
}

/**
 * Sends an outstanding invitation again.
 *
 * `role` is passed only when the inviter is correcting it at the same time: an
 * offer nobody accepted is still editable, so re-sending is also the moment to
 * fix it rather than withdraw it and start over.
 */
export function useResendSpaceInvitation(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role?: SpaceMemberRole }) =>
      api.resendSpaceInvitation(spaceId, memberId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: spaceMemberKeys.list(spaceId) });
    },
  });
}

/**
 * A role change is also a change to what the course *is* to that person — a
 * student who becomes an instructor is no longer in the student count — so the
 * overview's numbers are invalidated with the roster.
 */
export function useUpdateSpaceMember(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: SpaceMemberRole }) =>
      api.updateSpaceMember(spaceId, memberId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: spaceMemberKeys.list(spaceId) });
      // Assigning somebody to teach a course is this call and nothing else:
      // the role *is* the credit, so the list of who is credited is one of the
      // two things a role change changes.
      qc.invalidateQueries({ queryKey: spaceMemberKeys.instructors(spaceId) });
      qc.invalidateQueries({ queryKey: ['space', spaceId, 'stats'] });
    },
  });
}

/** Removing a member takes their cohort memberships with them, server-side. */
export function useRemoveSpaceMember(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api.removeSpaceMember(spaceId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: spaceMemberKeys.list(spaceId) });
      qc.invalidateQueries({ queryKey: spaceMemberKeys.instructors(spaceId) });
      qc.invalidateQueries({ queryKey: ['space', spaceId, 'stats'] });
      qc.invalidateQueries({ queryKey: ['space', spaceId, 'cohorts'] });
    },
  });
}

/**
 * Accepting an invitation makes a course readable and puts the caller in its
 * student count, so everything that reads either is invalidated — including the
 * caller's own course list, which for somebody outside the organization is the
 * only place the course appears as theirs.
 */
export function useAcceptSpaceInvitation(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.acceptSpaceInvitation(spaceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: spaceMemberKeys.all });
      qc.invalidateQueries({ queryKey: spaceMemberKeys.mine() });
      // An invitation to teach becomes a credit the moment it is accepted, so
      // the course's own list of who teaches it is stale from here.
      qc.invalidateQueries({ queryKey: spaceMemberKeys.instructors(spaceId) });
      qc.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
}
