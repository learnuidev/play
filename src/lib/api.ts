import { fetchAuthSession } from 'aws-amplify/auth';
import type {
  AudioResponse,
  Comment,
  ContentFileResponse,
  ContentMutationResponse,
  ContentResponse,
  CompletionResponse,
  CreateCommentPayload,
  CreateContentPayload,
  CreateLoopPayload,
  CreateOrganizationPayload,
  CreateOrganizationResponse,
  CreateSectionPayload,
  CreateSpacePayload,
  CreateSpaceResponse,
  CreateVideoPayload,
  CreateVideoResponse,
  FavouriteResponse,
  ListCommentsResponse,
  ListContentFilesResponse,
  ListLoopsResponse,
  LoopLikeResponse,
  ListContentsResponse,
  ListFavouritesResponse,
  ListOrganizationsResponse,
  ListPlaylistResponse,
  ListSectionsResponse,
  ListSpacesResponse,
  ListVideosResponse,
  LoopResponse,
  PlaylistResponse,
  SectionResponse,
  SpaceThumbnailResponse,
  StreamResponse,
  SubtitleResponse,
  ThumbnailResponse,
  UpdateContentPayload,
  UpdateLoopPayload,
  UpdateSectionPayload,
  UploadContentFilePayload,
  UploadContentFileResponse,
  UploadSpaceThumbnailResponse,
  UploadThumbnailResponse,
  Video,
  VideoStatus,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

async function idToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await idToken()}`,
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      message = data.error?.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  /**
   * Lists videos. Without `organizationId` this is the caller's own uploads;
   * with it, the organization's whole library (any member can read it).
   */
  listVideos: (status?: VideoStatus, organizationId?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (organizationId) params.set('organizationId', organizationId);
    const query = params.toString();
    return request<ListVideosResponse>(`/videos${query ? `?${query}` : ''}`);
  },

  getVideo: (videoId: string) => request<{ video: Video }>(`/videos/${videoId}`),

  createVideo: (payload: CreateVideoPayload) =>
    request<CreateVideoResponse>('/videos', { method: 'POST', body: JSON.stringify(payload) }),

  updateVideo: (videoId: string, patch: Partial<Pick<Video, 'title' | 'description'>>) =>
    request<{ video: Video }>(`/videos/${videoId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteVideo: (videoId: string) => request<void>(`/videos/${videoId}`, { method: 'DELETE' }),

  retryVideo: (videoId: string) => request<{ video: Video }>(`/videos/${videoId}/retry`, { method: 'POST' }),

  getStream: (videoId: string) => request<StreamResponse>(`/videos/${videoId}/stream`),

  getAudio: (videoId: string) => request<AudioResponse>(`/videos/${videoId}/audio`),

  generateAudio: (videoId: string) => request<{ video: Video }>(`/videos/${videoId}/audio`, { method: 'POST' }),

  generateSubtitles: (videoId: string) => request<{ video: Video }>(`/videos/${videoId}/subtitles`, { method: 'POST' }),

  generateTranslations: (videoId: string, languages?: string[]) =>
    request<{ video: Video }>(`/videos/${videoId}/subtitles/translations`, {
      method: 'POST',
      body: JSON.stringify(languages?.length ? { languages } : {}),
    }),

  getSubtitles: (videoId: string) => request<SubtitleResponse>(`/videos/${videoId}/subtitles`),

  saveSubtitles: (videoId: string, content: string, language?: string) =>
    request<{ video: Video }>(`/videos/${videoId}/subtitles`, {
      method: 'PUT',
      body: JSON.stringify(language ? { content, language } : { content }),
    }),

  getThumbnail: (videoId: string) => request<ThumbnailResponse>(`/videos/${videoId}/thumbnail`),

  generateThumbnail: (videoId: string) =>
    request<{ video: Video }>(`/videos/${videoId}/thumbnail/frame`, { method: 'POST' }),

  uploadThumbnail: (videoId: string, payload: { contentType: string; size?: number }) =>
    request<UploadThumbnailResponse>(`/videos/${videoId}/thumbnail`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listOrganizations: () => request<ListOrganizationsResponse>('/organizations'),

  getOrganization: (orgId: string) =>
    request<CreateOrganizationResponse>(`/organizations/${orgId}`),

  createOrganization: (payload: CreateOrganizationPayload) =>
    request<CreateOrganizationResponse>('/organizations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Spaces (courses) an organization owns, newest first. */
  listSpaces: (orgId: string) => request<ListSpacesResponse>(`/organizations/${orgId}/spaces`),

  getSpace: (spaceId: string) => request<CreateSpaceResponse>(`/spaces/${spaceId}`),

  createSpace: (orgId: string, payload: CreateSpacePayload) =>
    request<CreateSpaceResponse>(`/organizations/${orgId}/spaces`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSpaceThumbnail: (spaceId: string) =>
    request<SpaceThumbnailResponse>(`/spaces/${spaceId}/thumbnail`),

  uploadSpaceThumbnail: (spaceId: string, payload: { contentType: string; size?: number }) =>
    request<UploadSpaceThumbnailResponse>(`/spaces/${spaceId}/thumbnail`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /**
   * A space's outline: its sections in reading order, each with the content
   * filed under it. One request paints the whole course page.
   */
  listSections: (spaceId: string) => request<ListSectionsResponse>(`/spaces/${spaceId}/sections`),

  getSection: (sectionId: string) => request<SectionResponse>(`/sections/${sectionId}`),

  createSection: (spaceId: string, payload: CreateSectionPayload) =>
    request<SectionResponse>(`/spaces/${spaceId}/sections`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSection: (sectionId: string, patch: UpdateSectionPayload) =>
    request<SectionResponse>(`/sections/${sectionId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteSection: (sectionId: string) => request<void>(`/sections/${sectionId}`, { method: 'DELETE' }),

  listContents: (sectionId: string) =>
    request<ListContentsResponse>(`/sections/${sectionId}/contents`),

  createContent: (sectionId: string, payload: CreateContentPayload) =>
    request<ContentMutationResponse>(`/sections/${sectionId}/contents`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** One piece of content, plus what the caller has done with it. */
  getContent: (contentId: string) => request<ContentResponse>(`/contents/${contentId}`),

  updateContent: (contentId: string, patch: UpdateContentPayload) =>
    request<ContentMutationResponse>(`/contents/${contentId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteContent: (contentId: string) => request<void>(`/contents/${contentId}`, { method: 'DELETE' }),

  /** Reserves an attachment and returns the presigned PUT the client uploads to. */
  uploadContentFile: (contentId: string, payload: UploadContentFilePayload) =>
    request<UploadContentFileResponse>(`/contents/${contentId}/files`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listContentFiles: (contentId: string) =>
    request<ListContentFilesResponse>(`/contents/${contentId}/files`),

  getContentFile: (contentId: string, fileId: string) =>
    request<ContentFileResponse>(`/contents/${contentId}/files/${fileId}`),

  deleteContentFile: (contentId: string, fileId: string) =>
    request<void>(`/contents/${contentId}/files/${fileId}`, { method: 'DELETE' }),

  // Learner state. Nothing in the app calls these yet — the classroom does.
  favouriteContent: (contentId: string) =>
    request<FavouriteResponse>(`/contents/${contentId}/favourite`, { method: 'PUT' }),

  unfavouriteContent: (contentId: string) =>
    request<FavouriteResponse>(`/contents/${contentId}/favourite`, { method: 'DELETE' }),

  addToPlaylist: (contentId: string) =>
    request<PlaylistResponse>(`/contents/${contentId}/playlist`, { method: 'PUT' }),

  removeFromPlaylist: (contentId: string) =>
    request<PlaylistResponse>(`/contents/${contentId}/playlist`, { method: 'DELETE' }),

  listFavourites: () => request<ListFavouritesResponse>('/me/favourites'),

  listPlaylist: () => request<ListPlaylistResponse>('/me/playlist'),

  // Progress: the caller's own record of what they have finished.
  completeContent: (contentId: string) =>
    request<CompletionResponse>(`/contents/${contentId}/completion`, { method: 'PUT' }),

  uncompleteContent: (contentId: string) =>
    request<CompletionResponse>(`/contents/${contentId}/completion`, { method: 'DELETE' }),

  // Loops: the caller's own named stretches of a lesson, for hearing a piece
  // again. Nobody else can see them.
  listLoops: (contentId: string) => request<ListLoopsResponse>(`/contents/${contentId}/loops`),

  createLoop: (contentId: string, payload: CreateLoopPayload) =>
    request<LoopResponse>(`/contents/${contentId}/loops`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLoop: (contentId: string, loopId: string, patch: UpdateLoopPayload) =>
    request<LoopResponse>(`/contents/${contentId}/loops/${loopId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteLoop: (contentId: string, loopId: string) =>
    request<void>(`/contents/${contentId}/loops/${loopId}`, { method: 'DELETE' }),

  /** Loops are shared with the course, so any member may like any of them. */
  likeLoop: (contentId: string, loopId: string) =>
    request<LoopLikeResponse>(`/contents/${contentId}/loops/${loopId}/like`, { method: 'PUT' }),

  unlikeLoop: (contentId: string, loopId: string) =>
    request<LoopLikeResponse>(`/contents/${contentId}/loops/${loopId}/like`, { method: 'DELETE' }),

  listComments: (contentId: string) =>
    request<ListCommentsResponse>(`/contents/${contentId}/comments`),

  createComment: (contentId: string, payload: CreateCommentPayload) =>
    request<{ comment: Comment }>(`/contents/${contentId}/comments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateComment: (contentId: string, commentId: string, body: string) =>
    request<{ comment: Comment }>(`/contents/${contentId}/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }),

  deleteComment: (contentId: string, commentId: string) =>
    request<void>(`/contents/${contentId}/comments/${commentId}`, { method: 'DELETE' }),

  favouriteComment: (contentId: string, commentId: string) =>
    request<FavouriteResponse>(`/contents/${contentId}/comments/${commentId}/favourite`, {
      method: 'PUT',
    }),

  unfavouriteComment: (contentId: string, commentId: string) =>
    request<FavouriteResponse>(`/contents/${contentId}/comments/${commentId}/favourite`, {
      method: 'DELETE',
    }),
};
