import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@api/lib/api';

export const organizationKeys = {
  all: ['organizations'] as const,
  list: () => ['organizations', 'list'] as const,
  detail: (orgId: string) => ['organization', orgId] as const,
};

export function useOrganizations() {
  return useQuery({
    queryKey: organizationKeys.list(),
    queryFn: () => api.listOrganizations(),
  });
}

export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.detail(orgId),
    queryFn: () => api.getOrganization(orgId),
    enabled: Boolean(orgId),
    // A 403 here is an answer, not a blip: the caller is not a member of this
    // organization. Retrying it only delays saying so.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 403) return false;
      return failureCount < 3;
    },
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createOrganization>[0]) => api.createOrganization(payload),
    onSuccess: ({ organization }) => {
      qc.setQueryData(organizationKeys.detail(organization.orgId), { organization });
      qc.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}
