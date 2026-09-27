import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { organizationKeys } from '../organization/organization.queries';
import type { OrgRole } from '@/types';

export const memberKeys = {
  all: ['members'] as const,
  list: (orgId: string) => ['members', 'list', orgId] as const,
  invitations: () => ['members', 'invitations'] as const,
};

/**
 * The invitations addressed to the caller, across every organization.
 *
 * The one read somebody who belongs nowhere yet can make, and the only way an
 * invited person finds out they were invited at all.
 */
export function useMyInvitations() {
  return useQuery({
    queryKey: memberKeys.invitations(),
    queryFn: () => api.listMyInvitations(),
    staleTime: 30 * 1000,
  });
}

/**
 * Who is in the organization.
 *
 * A roster changes when somebody else acts on it, so it is not held for long:
 * an admin who invites while a colleague removes is looking at a list that has
 * to catch up quickly.
 */
export function useMembers(orgId: string) {
  return useQuery({
    queryKey: memberKeys.list(orgId),
    queryFn: () => api.listMembers(orgId),
    enabled: Boolean(orgId),
    staleTime: 30 * 1000,
  });
}

export function useInviteMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; role: OrgRole }) => api.inviteMember(orgId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKeys.list(orgId) });
    },
  });
}

/**
 * Changing a role can change what the caller themselves may do — an admin may
 * demote themselves — so the organization is invalidated too, not just the
 * roster.
 */
export function useUpdateMemberRole(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: OrgRole }) =>
      api.updateMemberRole(orgId, memberId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKeys.list(orgId) });
      qc.invalidateQueries({ queryKey: organizationKeys.detail(orgId) });
    },
  });
}

export function useRemoveMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api.removeMember(orgId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKeys.list(orgId) });
      qc.invalidateQueries({ queryKey: organizationKeys.detail(orgId) });
    },
  });
}

/**
 * Accepting an invitation makes an organization appear in the community rail,
 * so everything the organization list feeds is invalidated.
 */
export function useAcceptInvitation(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.acceptInvitation(orgId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKeys.all });
      qc.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}
