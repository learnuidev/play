import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
