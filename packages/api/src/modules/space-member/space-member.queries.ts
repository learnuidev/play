import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import type { SpaceMemberRole } from '@play/types';

export const spaceMemberKeys = {
  all: ['space-members'] as const,
  list: (spaceId: string) => ['space', spaceId, 'members'] as const,
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

export function useInviteSpaceMember(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; role: SpaceMemberRole }) =>
      api.inviteSpaceMember(spaceId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: spaceMemberKeys.list(spaceId) });
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
      qc.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
}
