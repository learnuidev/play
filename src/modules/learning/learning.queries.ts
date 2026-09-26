import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { contentKeys } from '@/modules/content/content.queries';
import type {
  ApiComment,
  CommentThread,
  ContentResponse,
  CreateCommentPayload,
  ListCommentsResponse,
} from '@/types';

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

/**
 * Posting a comment, or a reply.
 *
 * What was written is put into the thread rather than waited for: a discussion
 * is a conversation, and the words are already on the screen the reader typed
 * them into. The shape the server assembles is the shape the cache holds, so
 * this is an append at one of two levels.
 */
export function useCreateComment(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCommentPayload) => api.createComment(contentId, payload),
    onSuccess: ({ comment }) => {
      const written: ApiComment = { ...comment, favourited: false };

      qc.setQueryData<ListCommentsResponse>(learningKeys.comments(contentId), (prev) => {
        if (!prev) return prev;

        if (!written.parentId) {
          return { ...prev, threads: [...prev.threads, { comment: written, replies: [] }] };
        }

        return {
          ...prev,
          threads: prev.threads.map((thread) =>
            thread.comment.commentId === written.parentId
              ? { ...thread, replies: [...thread.replies, written] }
              : thread,
          ),
        };
      });

      // The lesson carries the count, and the server is the one that moved it.
      qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
    },
  });
}

/** Editing a comment writes the new words straight back into the thread. */
export function useUpdateComment(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      api.updateComment(contentId, commentId, body),
    onSuccess: ({ comment }) => {
      qc.setQueryData<ListCommentsResponse>(learningKeys.comments(contentId), (prev) =>
        prev
          ? {
              ...prev,
              threads: withEdit(prev.threads, comment.commentId, comment.body, comment.editedAt),
            }
          : prev,
      );
    },
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

/** Writes one comment's new favourite into a cached thread, at either level. */
function withFavourite(
  threads: CommentThread[],
  commentId: string,
  favourited: boolean,
  favouriteCount: number,
): CommentThread[] {
  const patch = (comment: ApiComment) =>
    comment.commentId === commentId ? { ...comment, favourited, favouriteCount } : comment;

  return threads.map((thread) => ({
    comment: patch(thread.comment),
    replies: thread.replies.map(patch),
  }));
}

/** Rewrites one comment's words in a cached thread, at either level. */
function withEdit(
  threads: CommentThread[],
  commentId: string,
  body: string,
  editedAt?: number,
): CommentThread[] {
  const patch = (comment: ApiComment) =>
    comment.commentId === commentId ? { ...comment, body, editedAt } : comment;

  return threads.map((thread) => ({
    comment: patch(thread.comment),
    replies: thread.replies.map(patch),
  }));
}

/**
 * Favouriting somebody's comment — a heart on a row, so it has to land on the
 * row it was pressed on rather than a request later.
 *
 * The answer already carries the new state and the count it produced, so the
 * thread is written from it. A double tap is one favourite and one increment on
 * the server either way: the row is only created by a conditional write.
 */
export function useToggleCommentFavourite(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, favourited }: { commentId: string; favourited: boolean }) =>
      favourited ? api.unfavouriteComment(contentId, commentId) : api.favouriteComment(contentId, commentId),
    onSuccess: ({ favourited, favouriteCount }, { commentId }) => {
      qc.setQueryData<ListCommentsResponse>(learningKeys.comments(contentId), (prev) =>
        prev
          ? {
              ...prev,
              threads: withFavourite(prev.threads, commentId, favourited, favouriteCount),
            }
          : prev,
      );
    },
  });
}
