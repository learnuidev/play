import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { contentKeys } from '@/modules/content/content.queries';
import type { ContentResponse, CreateCommentPayload } from '@/types';

/**
 * The frontend half of the learner surface: favouriting content, keeping a
 * learning playlist, and the discussion on a piece of content.
 *
 * No page renders any of this yet — the classroom does. It is here now so that
 * the classroom is a UI over an API that already exists, rather than a UI that
 * arrives with an API still to be written behind it.
 */

export const learningKeys = {
  favourites: ['learning', 'favourites'] as const,
  playlist: ['learning', 'playlist'] as const,
  comments: (contentId: string) => ['content', contentId, 'comments'] as const,
};

/** Everything the caller has favourited — content and comments. */
export function useFavourites() {
  return useQuery({
    queryKey: learningKeys.favourites,
    queryFn: () => api.listFavourites(),
  });
}

/** The caller's learning playlist, most recently added first. */
export function usePlaylist() {
  return useQuery({
    queryKey: learningKeys.playlist,
    queryFn: () => api.listPlaylist(),
  });
}

/** A piece of content's comments, as two-level threads. */
export function useComments(contentId: string) {
  return useQuery({
    queryKey: learningKeys.comments(contentId),
    queryFn: () => api.listComments(contentId),
    enabled: Boolean(contentId),
  });
}

/**
 * Favouriting and playlisting both change the content's own counters, so both
 * invalidate the content — a learner's state and the count it moves are read
 * from the same response.
 */
function useContentInvalidation(contentId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
    qc.invalidateQueries({ queryKey: learningKeys.favourites });
    qc.invalidateQueries({ queryKey: learningKeys.playlist });
  };
}

export function useToggleFavourite(contentId: string) {
  const qc = useQueryClient();
  const invalidate = useContentInvalidation(contentId);
  return useMutation({
    mutationFn: (favourited: boolean) =>
      favourited ? api.unfavouriteContent(contentId) : api.favouriteContent(contentId),
    onSuccess: ({ favourited, favouriteCount }) => {
      // The response already carries the new state and count, so the content is
      // written from it rather than refetched a moment later.
      qc.setQueryData<ContentResponse>(contentKeys.detail(contentId), (prev) =>
        prev
          ? {
              content: { ...prev.content, favouriteCount },
              viewer: { ...prev.viewer, favourited },
            }
          : prev,
      );
      invalidate();
    },
  });
}

export function useTogglePlaylist(contentId: string) {
  const qc = useQueryClient();
  const invalidate = useContentInvalidation(contentId);
  return useMutation({
    mutationFn: (inPlaylist: boolean) =>
      inPlaylist ? api.removeFromPlaylist(contentId) : api.addToPlaylist(contentId),
    onSuccess: ({ inPlaylist }) => {
      qc.setQueryData<ContentResponse>(contentKeys.detail(contentId), (prev) =>
        prev ? { ...prev, viewer: { ...prev.viewer, inPlaylist } } : prev,
      );
      invalidate();
    },
  });
}

export function useCreateComment(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCommentPayload) => api.createComment(contentId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: learningKeys.comments(contentId) });
      qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
    },
  });
}

export function useUpdateComment(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      api.updateComment(contentId, commentId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: learningKeys.comments(contentId) }),
  });
}

export function useDeleteComment(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.deleteComment(contentId, commentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: learningKeys.comments(contentId) });
      qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
    },
  });
}

export function useToggleCommentFavourite(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, favourited }: { commentId: string; favourited: boolean }) =>
      favourited ? api.unfavouriteComment(contentId, commentId) : api.favouriteComment(contentId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: learningKeys.comments(contentId) }),
  });
}
