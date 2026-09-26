import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const spaceKeys = {
  all: ['spaces'] as const,
  list: (orgId: string) => ['spaces', 'list', orgId] as const,
  detail: (spaceId: string) => ['space', spaceId] as const,
  thumbnail: (spaceId: string) => ['space', spaceId, 'thumbnail'] as const,
};

/** Every space the organization owns. Newest first, as the API returns them. */
export function useSpaces(orgId: string) {
  return useQuery({
    queryKey: spaceKeys.list(orgId),
    queryFn: () => api.listSpaces(orgId),
    enabled: Boolean(orgId),
  });
}

export function useSpace(spaceId: string) {
  return useQuery({
    queryKey: spaceKeys.detail(spaceId),
    queryFn: () => api.getSpace(spaceId),
    enabled: Boolean(spaceId),
  });
}

/** A space's cover image, signed. Only asked for once the space has a key. */
export function useSpaceThumbnail(spaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: spaceKeys.thumbnail(spaceId),
    queryFn: () => api.getSpaceThumbnail(spaceId),
    enabled: Boolean(spaceId) && enabled,
    // A signed URL expires on a clock the client cannot see; refetch a little
    // before the shortest TTL so a cover never goes blank mid-session.
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateSpace(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createSpace>[1]) => api.createSpace(orgId, payload),
    onSuccess: ({ space }) => {
      qc.setQueryData(spaceKeys.detail(space.spaceId), { space });
      qc.invalidateQueries({ queryKey: spaceKeys.list(orgId) });
    },
  });
}

/**
 * Reserves a cover upload for a space and points the space at it. The bytes go
 * straight to S3 from the caller; only the key passes through the API.
 */
export function useUploadSpaceThumbnail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spaceId, ...payload }: { spaceId: string } & Parameters<typeof api.uploadSpaceThumbnail>[1]) =>
      api.uploadSpaceThumbnail(spaceId, payload),
    onSuccess: ({ space }) => {
      qc.setQueryData(spaceKeys.detail(space.spaceId), { space });
      qc.invalidateQueries({ queryKey: spaceKeys.thumbnail(space.spaceId) });
    },
  });
}
