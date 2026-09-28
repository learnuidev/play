import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import type { ProfileResponse, UpdateProfilePayload } from '@play/types';

export const profileKeys = {
  all: ['profile'] as const,
  mine: () => ['profile', 'me'] as const,
};

/**
 * The signed-in person's own profile.
 *
 * Held rather than refetched on every page: it is somebody's name and photo, it
 * changes when they change it, and every mutation below writes the answer it got
 * back into this cache. The read is also what names the account, which is why it
 * is worth making once early — the studio's account menu does, so a person is
 * named the first time they are seen rather than the first time somebody looks
 * at a course they teach.
 */
export function useMyProfile() {
  return useQuery({
    queryKey: profileKeys.mine(),
    queryFn: () => api.getMyProfile(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Editing it.
 *
 * The response *is* the new profile, so it replaces the cache rather than
 * invalidating it: a form that shows what the API stored is a form that cannot
 * disagree with it, and a refetch would only ask a question already answered.
 *
 * What else changes is what other people see — a roster, a course page, an
 * instructor's page — and none of those are this person's cache entries to
 * reach. They go stale on their own clock, which is the honest cost of showing a
 * name somebody just changed.
 */
export function useUpdateMyProfile() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateProfilePayload) => api.updateMyProfile(payload),
    onSuccess: (data: ProfileResponse) => {
      qc.setQueryData(profileKeys.mine(), data);
    },
  });
}

/**
 * Reserving a photo upload.
 *
 * The row points at the new object before the bytes are sent, so the profile the
 * API hands back already carries the new `photoUrl` — and the screen shows the
 * photo as soon as the upload lands, with nothing to invalidate.
 */
export function useUploadProfilePhoto() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: { contentType: string; size?: number }) =>
      api.uploadProfilePhoto(payload),
    onSuccess: (data) => {
      qc.setQueryData(profileKeys.mine(), { profile: data.profile });
    },
  });
}
