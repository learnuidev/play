import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import type { ApiKey, CreateApiKeyPayload } from '@play/types';

export const apiKeyKeys = {
  all: ['api-keys'] as const,
  mine: () => ['api-keys', 'mine'] as const,
  organization: (orgId: string) => ['api-keys', 'organization', orgId] as const,
};

/**
 * The caller's own keys.
 *
 * Held for a moment rather than for long: a key list is read to decide
 * something — revoke this one, make another — and the answer has to be current
 * when the decision is made. Every mutation below invalidates it.
 */
export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyKeys.mine(),
    queryFn: () => api.listApiKeys(),
    staleTime: 30 * 1000,
  });
}

/**
 * Makes a key and hands back the secret.
 *
 * Deliberately without a cache write for the new key: what the caller needs from
 * this call is the secret, which is shown once and then gone, and the list is
 * refetched beside it. Caching the response would keep a usable credential in
 * the query cache for as long as the page is open.
 */
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateApiKeyPayload) => api.createApiKey(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apiKeyKeys.all });
    },
  });
}

/**
 * Cuts off one of the caller's own keys.
 *
 * The revoked key leaves the list rather than staying in it wearing a badge.
 * The effect of revoking is that the key is gone, so the row it was in goes with
 * it — taken out of the cache at once so the list answers before the refetch
 * does, and the refetch is what makes the rest of the list current.
 */
export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => api.revokeApiKey(keyId),
    onSuccess: ({ key }) => {
      qc.setQueryData<{ keys: ApiKey[] }>(apiKeyKeys.mine(), (current) =>
        current ? { ...current, keys: current.keys.filter((k) => k.keyId !== key.keyId) } : current,
      );
      qc.invalidateQueries({ queryKey: apiKeyKeys.all });
    },
  });
}

/** Every key made for an organization. Asked for by its admins only. */
export function useOrganizationApiKeys(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: apiKeyKeys.organization(orgId),
    queryFn: () => api.listOrganizationApiKeys(orgId),
    enabled: Boolean(orgId) && enabled,
    staleTime: 30 * 1000,
  });
}

export function useRevokeOrganizationApiKey(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => api.revokeOrganizationApiKey(orgId, keyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apiKeyKeys.organization(orgId) });
      // The key may also be the caller's own, in which case their list just
      // changed under them.
      qc.invalidateQueries({ queryKey: apiKeyKeys.mine() });
    },
  });
}
