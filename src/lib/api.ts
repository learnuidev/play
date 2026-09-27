import { fetchAuthSession } from 'aws-amplify/auth';
import type {
  AudioResponse,
  CohortResponse,
  Comment,
  ContentFileResponse,
  ContentMutationResponse,
  ContentResponse,
  CompletionResponse,
  CreateCohortPayload,
  CreateCommentPayload,
  CreateContentPayload,
  CreateLoopPayload,
  CreateOrganizationPayload,
  CreateOrganizationResponse,
  CreateRewardPayload,
  CreateSectionPayload,
  CreateSpacePayload,
  CreateSpaceResponse,
  CreateVideoPayload,
  CreateVideoResponse,
  FavouriteResponse,
  GrantRewardPayload,
  InviteMemberPayload,
  InviteMemberResponse,
  InviteSpaceMemberPayload,
  InviteSpaceMemberResponse,
  ListCohortsResponse,
  ListCommentsResponse,
  ListContentFilesResponse,
  ListLoopsResponse,
  LoopLikeResponse,
  ListContentsResponse,
  ListFavouritesResponse,
  ListMyInvitationsResponse,
  ListMyCoursesResponse,
  ListMyRewardsResponse,
  ListMySpaceInvitationsResponse,
  ListOrgMembersResponse,
  ListOrganizationsResponse,
  ListPlaylistResponse,
  ListRewardsResponse,
  ListSectionsResponse,
  ListSpaceMembersResponse,
  ListSpacesResponse,
  ListVideosResponse,
  LoopResponse,
  OrgMemberResponse,
  OrgRole,
  ResendInvitationResponse,
  ResendSpaceInvitationResponse,
  PlaylistResponse,
  RevokeRewardGrantResponse,
  RewardGrantResponse,
  RewardResponse,
  SectionResponse,
  SpaceMemberResponse,
  SpaceMemberRole,
  SpaceStatsResponse,
  SpaceThumbnailResponse,
  StreamResponse,
  SubtitleResponse,
  ThumbnailResponse,
  UpdateCohortPayload,
  UpdateContentPayload,
  UpdateLoopPayload,
  UpdateRewardPayload,
  UpdateSectionPayload,
  UpdateSpacePayload,
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

/**
 * A failed API call, carrying the status it failed with.
 *
 * The message is what a page shows; the status is what a page acts on — an
 * invitation to an organization the caller is not yet a member of answers 403,
 * and that is a page state rather than an error.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
    throw new ApiError(res.status, message);
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

  /**
   * The organization's roster: who has joined, and which invitations are still
   * outstanding. Email addresses come back only for admins.
   */
  listMembers: (orgId: string) => request<ListOrgMembersResponse>(`/organizations/${orgId}/members`),

  inviteMember: (orgId: string, payload: InviteMemberPayload) =>
    request<InviteMemberResponse>(`/organizations/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /**
   * Sends an outstanding invitation again, to the address it was made to. The
   * role may be corrected in the same call — an offer nobody has accepted is
   * still editable.
   */
  resendInvitation: (orgId: string, memberId: string, role?: OrgRole) =>
    request<ResendInvitationResponse>(
      `/organizations/${orgId}/members/${encodeURIComponent(memberId)}/invitation`,
      { method: 'POST', body: JSON.stringify(role ? { role } : {}) },
    ),

  /**
   * The member's id goes in the path, and while their invitation is pending
   * that id is their email address — hence the encoding.
   */
  updateMemberRole: (orgId: string, memberId: string, role: OrgRole) =>
    request<OrgMemberResponse>(`/organizations/${orgId}/members/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  /** Removes a member, or withdraws an invitation nobody accepted yet. */
  removeMember: (orgId: string, memberId: string) =>
    request<void>(`/organizations/${orgId}/members/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    }),

  /** Claims the invitation addressed to the caller's own verified email. */
  acceptInvitation: (orgId: string) =>
    request<OrgMemberResponse>(`/organizations/${orgId}/invitation`, { method: 'POST' }),

  /** Invitations addressed to the caller, in every organization. */
  listMyInvitations: () => request<ListMyInvitationsResponse>('/me/invitations'),

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

  /** Edits what a course says about itself, from the overview tab. */
  updateSpace: (spaceId: string, patch: UpdateSpacePayload) =>
    request<CreateSpaceResponse>(`/spaces/${spaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** The overview's four cards: students, sections, lessons, quizzes. */
  getSpaceStats: (spaceId: string) => request<SpaceStatsResponse>(`/spaces/${spaceId}/stats`),

  /**
   * The course's roster: who is taking it, and which invitations are still
   * outstanding. Addresses come back only for whoever may manage it.
   */
  listSpaceMembers: (spaceId: string) =>
    request<ListSpaceMembersResponse>(`/spaces/${spaceId}/members`),

  inviteSpaceMember: (spaceId: string, payload: InviteSpaceMemberPayload) =>
    request<InviteSpaceMemberResponse>(`/spaces/${spaceId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /**
   * A course member's id goes in the path, and while their invitation is
   * pending that id is their email address — hence the encoding.
   */
  updateSpaceMember: (spaceId: string, memberId: string, role: SpaceMemberRole) =>
    request<SpaceMemberResponse>(`/spaces/${spaceId}/members/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  /** Removes a member, or withdraws an invitation nobody accepted yet. */
  removeSpaceMember: (spaceId: string, memberId: string) =>
    request<void>(`/spaces/${spaceId}/members/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    }),

  /** Sends an outstanding course invitation again, optionally fixing its role. */
  resendSpaceInvitation: (spaceId: string, memberId: string, role?: SpaceMemberRole) =>
    request<ResendSpaceInvitationResponse>(
      `/spaces/${spaceId}/members/${encodeURIComponent(memberId)}/invitation`,
      { method: 'POST', body: JSON.stringify(role ? { role } : {}) },
    ),

  /** Claims the course invitation addressed to the caller's own verified email. */
  acceptSpaceInvitation: (spaceId: string) =>
    request<SpaceMemberResponse>(`/spaces/${spaceId}/invitation`, { method: 'POST' }),

  /** Course invitations addressed to the caller, in every organization. */
  listMySpaceInvitations: () =>
    request<ListMySpaceInvitationsResponse>('/me/space-invitations'),

  /** The courses the caller is in, wherever they are. */
  listMyCourses: () => request<ListMyCoursesResponse>('/me/spaces'),

  /** A course's cohorts, each with the ids of the members in it. */
  listCohorts: (spaceId: string) => request<ListCohortsResponse>(`/spaces/${spaceId}/cohorts`),

  createCohort: (spaceId: string, payload: CreateCohortPayload) =>
    request<CohortResponse>(`/spaces/${spaceId}/cohorts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCohort: (cohortId: string, patch: UpdateCohortPayload) =>
    request<CohortResponse>(`/cohorts/${cohortId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteCohort: (cohortId: string) => request<void>(`/cohorts/${cohortId}`, { method: 'DELETE' }),

  /** Putting a member in a cohort, and taking them out of it. Both idempotent. */
  addCohortMember: (cohortId: string, memberId: string) =>
    request<CohortResponse>(`/cohorts/${cohortId}/members/${encodeURIComponent(memberId)}`, {
      method: 'PUT',
    }),

  removeCohortMember: (cohortId: string, memberId: string) =>
    request<CohortResponse>(`/cohorts/${cohortId}/members/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    }),

  /** A course's rewards, each with the grants made under it. */
  listRewards: (spaceId: string) => request<ListRewardsResponse>(`/spaces/${spaceId}/rewards`),

  createReward: (spaceId: string, payload: CreateRewardPayload) =>
    request<RewardResponse>(`/spaces/${spaceId}/rewards`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateReward: (rewardId: string, patch: UpdateRewardPayload) =>
    request<RewardResponse>(`/rewards/${rewardId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteReward: (rewardId: string) => request<void>(`/rewards/${rewardId}`, { method: 'DELETE' }),

  /** Hands a reward to a member by hand, rather than by their earning it. */
  grantReward: (rewardId: string, payload: GrantRewardPayload) =>
    request<RewardGrantResponse>(`/rewards/${rewardId}/grants`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Takes a reward back: removed while unused, revoked once it has been used. */
  revokeRewardGrant: (rewardId: string, memberId: string) =>
    request<RevokeRewardGrantResponse>(
      `/rewards/${rewardId}/grants/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    ),

  /** What the caller has earned, across every course. */
  listMyRewards: () => request<ListMyRewardsResponse>('/me/rewards'),

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
