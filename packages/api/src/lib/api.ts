import { fetchAuthSession } from 'aws-amplify/auth';
import type {
  AddQuizQuestionsResponse,
  ApproveAuthorizationResponse,
  AudioResponse,
  BatchVerificationResponse,
  CatalogCourseResponse,
  CohortResponse,
  Comment,
  CompletionResponse,
  ContentFileResponse,
  ContentMutationResponse,
  ContentResponse,
  CreateApiKeyPayload,
  CreateApiKeyResponse,
  CreateCohortPayload,
  CreateCommentPayload,
  CreateContentPayload,
  CreateLoopPayload,
  CreateOAuthAppPayload,
  CreateOAuthAppResponse,
  CreateOrganizationPayload,
  CreateOrganizationResponse,
  CreateQuestionBankPayload,
  CreateQuestionPayload,
  CreateRewardPayload,
  CreateSectionPayload,
  CreateSpacePayload,
  CreateSpaceResponse,
  CreateVideoPayload,
  CreateVideoResponse,
  FavouriteResponse,
  FavouriteTargetType,
  GenerateQuestionsPayload,
  GrantRewardPayload,
  ImportQuestionsPayload,
  ImportQuestionsResponse,
  InstructorResponse,
  InviteMemberPayload,
  InviteMemberResponse,
  InviteSpaceMemberPayload,
  InviteSpaceMemberResponse,
  ListApiKeysResponse,
  ListBankQuestionsResponse,
  ListCatalogResponse,
  ListCohortsResponse,
  ListCommentsResponse,
  ListContentFilesResponse,
  ListContentsResponse,
  ListFavouritesResponse,
  ListInstructorsResponse,
  ListLoopsResponse,
  ListMyCoursesResponse,
  ListMyInvitationsResponse,
  ListMyProgressResponse,
  ListMyRewardsResponse,
  ListMySpaceInvitationsResponse,
  ListOAuthAppsResponse,
  ListOAuthConnectionsResponse,
  ListOrgMembersResponse,
  ListOrganizationApiKeysResponse,
  ListOrganizationsResponse,
  ListPlaylistResponse,
  ListQuestionBanksResponse,
  ListQuestionsResponse,
  ListRewardsResponse,
  ListSectionsResponse,
  ListSpaceMembersResponse,
  ListSpacesResponse,
  ListVideosResponse,
  LoopLikeResponse,
  LoopResponse,
  OAuthAppResponse,
  OAuthAuthorizationParams,
  OAuthAuthorizationRequestResponse,
  OrgMemberResponse,
  OrgRole,
  PlaceContentPayload,
  PlaceQuizQuestionPayload,
  PlaylistResponse,
  ProfileResponse,
  QuestionBankResponse,
  QuestionResponse,
  QuestionsResponse,
  QuizAttemptResponse,
  QuizPaperResponse,
  ResendInvitationResponse,
  ResendSpaceInvitationResponse,
  RevokeRewardGrantResponse,
  RewardGrantResponse,
  RewardResponse,
  RotateClientSecretResponse,
  SectionResponse,
  SpaceMemberResponse,
  SpaceMemberRole,
  SpaceProgressResponse,
  SpaceStatsResponse,
  SpaceThumbnailResponse,
  StreamResponse,
  SubmitQuizAttemptPayload,
  SubtitleResponse,
  ThumbnailResponse,
  UpdateCohortPayload,
  UpdateContentPayload,
  UpdateLoopPayload,
  UpdateOAuthAppPayload,
  UpdateOAuthAppResponse,
  UpdateProfilePayload,
  UpdateQuestionBankPayload,
  UpdateQuestionPayload,
  UpdateRewardPayload,
  UpdateSectionPayload,
  UpdateSpacePayload,
  UploadContentFilePayload,
  UploadContentFileResponse,
  UploadProfilePhotoResponse,
  UploadSpaceThumbnailResponse,
  UploadThumbnailResponse,
  Video,
  VideoStatus,
} from '@play/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * The caller's token, or nothing when they have not signed in.
 *
 * `fetchAuthSession` throws when there is no session at all and returns tokens
 * without an id token when the session has lapsed, so both are "not signed in"
 * here rather than errors — asking a public endpoint who you are is allowed to
 * have no answer.
 *
 * Exported because it is not only these requests that need one: the API
 * reference's playground calls the API directly, and a token it fetched its own
 * way would be a second answer to "who is signed in".
 */
export async function authTokenOrNull(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

/**
 * How a request is authenticated.
 *
 * - `required` — the default: the caller must be signed in, and the request
 *   fails without a token rather than going out anonymously.
 * - `optional` — a public endpoint that behaves differently when it knows who
 *   is asking. The token is attached when there is one and the request goes out
 *   either way.
 * - `none` — the marketplace catalog, read by people who have never signed in.
 */
type AuthMode = 'required' | 'optional' | 'none';

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

async function request<T>(
  path: string,
  init: RequestInit = {},
  auth: AuthMode = 'required',
): Promise<T> {
  const token = auth === 'none' ? null : await authTokenOrNull();

  if (auth === 'required' && !token) {
    throw new ApiError(401, 'Not authenticated');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  /**
   * How far the caller has got in one course, with the lessons they have
   * finished named — what an outline ticks and a course page measures.
   */
  getSpaceProgress: (spaceId: string) =>
    request<SpaceProgressResponse>(`/spaces/${spaceId}/progress`),

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
   *
   * `limit` is for the screens that need the whole list rather than a page of
   * it — picking somebody to teach the course cannot be a choice between the
   * first twenty members — and it is capped by the API at its own maximum.
   */
  listSpaceMembers: (spaceId: string, limit?: number) =>
    request<ListSpaceMembersResponse>(
      `/spaces/${spaceId}/members${limit ? `?limit=${limit}` : ''}`,
    ),

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

  /**
   * Who teaches a course: the people it credits, rather than everybody in it.
   *
   * The same answer the marketplace gives for the same course, and readable by
   * anybody who can read the course — the studio draws it on the course's own
   * page, and an enrolled reader of an unlisted course draws it in the
   * marketplace, where the public catalog cannot answer for them.
   */
  listSpaceInstructors: (spaceId: string) =>
    request<ListInstructorsResponse>(`/spaces/${spaceId}/instructors`),

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

  /** Courses the caller is in, wherever they are. */
  listMyCourses: () => request<ListMyCoursesResponse>('/me/spaces'),

  /** How far the caller has got in each of those courses, in one read. */
  listMyProgress: () => request<ListMyProgressResponse>('/me/progress'),

  /**
   * The marketplace catalog: courses their authors have listed, newest first.
   *
   * Read without a token, because the people who read it have not signed in
   * yet — that is the whole point of a catalog.
   *
   * With `query` it searches instead of paging: the API answers a search from
   * a bounded read of the catalog and returns no `nextToken`, so a caller should
   * not try to page through search results.
   */
  listCatalogCourses: (opts: { query?: string; nextToken?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.query) params.set('query', opts.query);
    if (opts.nextToken) params.set('nextToken', opts.nextToken);
    const query = params.toString();
    return request<ListCatalogResponse>(`/catalog/courses${query ? `?${query}` : ''}`, {}, 'none');
  },

  /** One listed course, with the syllabus anybody may read. */
  getCatalogCourse: (spaceId: string) =>
    request<CatalogCourseResponse>(`/catalog/courses/${spaceId}`, {}, 'none'),

  /**
   * One instructor's public page: their name, their face, what they say about
   * themselves, and the courses they teach here.
   *
   * Public, like the course it is reached from — the reader following that link
   * is deciding whether to register, which is not a thing they can be asked to
   * sign in for first.
   */
  getCatalogInstructor: (userId: string) =>
    request<InstructorResponse>(`/catalog/instructors/${encodeURIComponent(userId)}`, {}, 'none'),

  /**
   * Registers the caller for a listed course.
   *
   * Idempotent on the server: registering for a course you are already in
   * answers with the membership you have, whichever way you got it. An
   * invitation waiting for the caller's address is claimed by the same call, so
   * an invited assistant registers as an assistant.
   */
  enrollInCourse: (spaceId: string) =>
    request<SpaceMemberResponse>(`/spaces/${spaceId}/enrollment`, { method: 'POST' }),

  /** Drops the caller out of a course. The course itself is untouched. */
  leaveCourse: (spaceId: string) =>
    request<void>(`/spaces/${spaceId}/enrollment`, { method: 'DELETE' }),

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

  /**
   * Where a lesson or a quiz sits in its section — what a drag performs.
   *
   * `index` is a place in the target section, zero-based, and the order that
   * results is the server's to work out: the page that drew the list cannot know
   * what has been added to it since, so it says "third from the top" and the
   * server makes that true.
   */
  placeContent: (contentId: string, payload: PlaceContentPayload) =>
    request<ContentMutationResponse>(`/contents/${contentId}/placement`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

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

  /**
   * An organization's question banks.
   *
   * A bank is where questions live; a quiz asks some of them. The list is
   * readable by any member of the organization — checking a colleague's
   * questions is reading — and everything that changes one takes an editor.
   */
  listQuestionBanks: (orgId: string) =>
    request<ListQuestionBanksResponse>(`/organizations/${orgId}/question-banks`),

  createQuestionBank: (orgId: string, payload: CreateQuestionBankPayload) =>
    request<QuestionBankResponse>(`/organizations/${orgId}/question-banks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getQuestionBank: (bankId: string) => request<QuestionBankResponse>(`/banks/${bankId}`),

  updateQuestionBank: (bankId: string, patch: UpdateQuestionBankPayload) =>
    request<QuestionBankResponse>(`/banks/${bankId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** Deletes a bank **and every question in it**, out of every quiz asking them. */
  deleteQuestionBank: (bankId: string) =>
    request<void>(`/banks/${bankId}`, { method: 'DELETE' }),

  /**
   * A bank's questions, with the bank itself and how many need reading.
   *
   * One request draws the whole page, and the page groups them by lesson: a bank
   * is a list somebody works down, and the grouping is how it is read rather
   * than how it is stored.
   */
  listBankQuestions: (bankId: string) =>
    request<ListBankQuestionsResponse>(`/banks/${bankId}/questions`),

  /** Writes one by hand. `lessonContentId` is required: every question is about a lesson. */
  createQuestion: (bankId: string, payload: CreateQuestionPayload) =>
    request<QuestionResponse>(`/banks/${bankId}/questions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /**
   * Imports questions from a file.
   *
   * The file travels base64 inside a JSON body because API Gateway's REST
   * integration has no multipart parser; the rows that could not be read come
   * back as `skipped`, each with the line it was on, rather than failing the
   * whole import. One file is about one lesson.
   */
  importQuestions: (bankId: string, payload: ImportQuestionsPayload) =>
    request<ImportQuestionsResponse>(`/banks/${bankId}/questions/import`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /**
   * Asks AI to write questions from a lesson.
   *
   * It answers `202` with the bank, not with questions: the run is queued,
   * because a model reading a transcript takes longer than API Gateway will hold
   * a request open. What comes back carries the run's state, and the page polls
   * it. With `addToContentId` the run also adds what it writes to that quiz.
   */
  generateQuestions: (bankId: string, payload: GenerateQuestionsPayload) =>
    request<QuestionBankResponse>(`/banks/${bankId}/questions/generation`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Forgets the last run on a bank, once its author has read why it failed. */
  dismissQuestionGeneration: (bankId: string) =>
    request<void>(`/banks/${bankId}/questions/generation`, { method: 'DELETE' }),

  /**
   * Verifying a batch. Without `questionIds` it is every question of the bank
   * that is still waiting, which is what an author who has just read a generated
   * set means by it.
   */
  verifyQuestions: (bankId: string, questionIds?: string[]) =>
    request<BatchVerificationResponse>(`/banks/${bankId}/questions/verification`, {
      method: 'POST',
      body: JSON.stringify(questionIds ? { questionIds } : {}),
    }),

  updateQuestion: (questionId: string, patch: UpdateQuestionPayload) =>
    request<QuestionResponse>(`/questions/${questionId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** Deletes it from its bank — and out of every quiz asking it. */
  deleteQuestion: (questionId: string) =>
    request<{ removedFrom: number }>(`/questions/${questionId}`, { method: 'DELETE' }),

  /**
   * A person saying a question is right — or taking that back.
   *
   * Two calls rather than one with a body, because it is one decision with two
   * directions and there is no third state to set: a question is either read by
   * somebody or it is not. It is the same act whichever page it is done from,
   * because it is the same question.
   */
  verifyQuestion: (questionId: string) =>
    request<QuestionResponse>(`/questions/${questionId}/verification`, { method: 'PUT' }),

  unverifyQuestion: (questionId: string) =>
    request<QuestionResponse>(`/questions/${questionId}/verification`, { method: 'DELETE' }),

  /**
   * Every question about one course's lessons, from every bank.
   *
   * The course page's own read: an author working through a course wants to know
   * what has been written for the lessons in it, wherever those questions live.
   * Organization-only, because questions carry the answer key.
   */
  listSpaceQuestions: (spaceId: string) =>
    request<ListQuestionsResponse>(`/spaces/${spaceId}/questions`),

  /** What a quiz asks, in the order it asks it. */
  listQuizQuestions: (contentId: string) =>
    request<ListQuestionsResponse>(`/contents/${contentId}/questions`),

  /**
   * Adds questions to a quiz. They stay in their banks — a quiz holds references,
   * not copies — and one already asked is counted rather than duplicated.
   */
  addQuizQuestions: (contentId: string, questionIds: string[]) =>
    request<AddQuizQuestionsResponse>(`/contents/${contentId}/questions`, {
      method: 'POST',
      body: JSON.stringify({ questionIds }),
    }),

  /** Takes a question out of a quiz. The question itself is untouched. */
  removeQuizQuestion: (contentId: string, questionId: string) =>
    request<void>(`/contents/${contentId}/questions/${questionId}`, { method: 'DELETE' }),

  /** Where a question sits in the quiz that asks it — what a drag performs. */
  placeQuizQuestion: (contentId: string, payload: PlaceQuizQuestionPayload) =>
    request<QuestionsResponse>(`/contents/${contentId}/questions/placement`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** Verifying a batch of one quiz's questions, from the page asking them. */
  verifyQuizQuestions: (contentId: string, questionIds?: string[]) =>
    request<BatchVerificationResponse>(`/contents/${contentId}/questions/verification`, {
      method: 'POST',
      body: JSON.stringify(questionIds ? { questionIds } : {}),
    }),

  /**
   * Taking a quiz, which is the other half of writing one.
   *
   * The paper is the quiz's questions without the answer key, served to whoever
   * may read the course, which is what lets somebody registered for it — and in
   * no organization at all — sit it. Handing it in is marked on the server, for
   * the obvious reason, and finishes the quiz: the response carries the
   * completion and any reward it earned, as marking a lesson complete does.
   */
  getQuiz: (contentId: string) => request<QuizPaperResponse>(`/contents/${contentId}/quiz`),

  submitQuizAttempt: (contentId: string, payload: SubmitQuizAttemptPayload) =>
    request<QuizAttemptResponse>(`/contents/${contentId}/quiz/attempts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Learner state. Nothing in the app calls these yet — the classroom does.
  favouriteContent: (contentId: string) =>
    request<FavouriteResponse>(`/contents/${contentId}/favourite`, { method: 'PUT' }),

  unfavouriteContent: (contentId: string) =>
    request<FavouriteResponse>(`/contents/${contentId}/favourite`, { method: 'DELETE' }),

  addToPlaylist: (contentId: string) =>
    request<PlaylistResponse>(`/contents/${contentId}/playlist`, { method: 'PUT' }),

  removeFromPlaylist: (contentId: string) =>
    request<PlaylistResponse>(`/contents/${contentId}/playlist`, { method: 'DELETE' }),

  /**
   * The caller's own favourites, or only one kind of them.
   *
   * The whole list is what a profile draws; one kind is what a screen wants, and
   * the API answers the narrower question with a narrower read rather than a
   * page whose other rows are discarded here.
   *
   * The list asks for the API's largest page rather than its default twenty, for
   * the reason the key list does: a favourites page that stopped at twenty
   * without saying so would be a page hiding the video you were looking for.
   */
  listFavourites: (type?: FavouriteTargetType) =>
    request<ListFavouritesResponse>(`/me/favourites?limit=100${type ? `&type=${type}` : ''}`),

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

  /**
   * API keys: the way somebody outside these two apps calls the API.
   *
   * The list asks for the API's largest page rather than its default twenty.
   * A key list is something you audit, and one that stopped at twenty without
   * saying so would be a screen that hides the key you were looking for.
   */
  listApiKeys: () => request<ListApiKeysResponse>('/me/api-keys?limit=100'),

  /**
   * Makes a key. The response carries the secret, and it is the only time the
   * API will ever hand one over: it keeps a hash, so nothing can read the key
   * back — a caller that loses it revokes it and makes another.
   */
  createApiKey: (payload: CreateApiKeyPayload) =>
    request<CreateApiKeyResponse>('/me/api-keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /**
   * Revokes one of the caller's own keys, which deletes it: it stops
   * authenticating at once and there is nothing left to read back.
   */
  revokeApiKey: (keyId: string) =>
    request<void>(`/me/api-keys/${keyId}`, { method: 'DELETE' }),

  /**
   * The OAuth apps the caller has registered.
   *
   * The other half of "how do I call this API from my own code", and the newer
   * half: a key is one credential that acts as one person forever, and an app is
   * a client that a person can *authorize* — so the app acts as them, with only
   * the scopes they agreed to on a screen, and can be disconnected from the
   * connections screen without anybody rotating anything.
   */
  listOAuthApps: () => request<ListOAuthAppsResponse>('/oauth/apps'),

  /**
   * Registers an app. The response carries the client secret, once, and only for
   * a confidential client: a public client has none, because one shipped inside
   * a browser bundle is not a secret.
   */
  createOAuthApp: (payload: CreateOAuthAppPayload) =>
    request<CreateOAuthAppResponse>('/oauth/apps', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getOAuthApp: (appId: string) => request<OAuthAppResponse>(`/oauth/apps/${appId}`),

  /**
   * Edits an app. Only the fields sent are written, and changing the scopes ends
   * every authorization the app has — the people who connected it are asked
   * again, with the new list on the screen.
   */
  updateOAuthApp: (appId: string, patch: UpdateOAuthAppPayload) =>
    request<UpdateOAuthAppResponse>(`/oauth/apps/${appId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** Deletes an app, ending every authorization of it on the way out. */
  deleteOAuthApp: (appId: string) => request<void>(`/oauth/apps/${appId}`, { method: 'DELETE' }),

  /**
   * Replaces the client secret, and hands the new one over exactly once. The old
   * secret stops working the moment this returns.
   */
  rotateOAuthAppSecret: (appId: string) =>
    request<RotateClientSecretResponse>(`/oauth/apps/${appId}/secret`, { method: 'POST' }),

  /**
   * What an authorization URL is asking for: which app, which scopes, and whether
   * this person has already agreed to them.
   *
   * Sent as the query string the client used, unchanged — the parameters are the
   * RFC 6749 ones precisely so that a third party's library can build them and
   * nothing here has to translate.
   */
  describeAuthorization: (params: OAuthAuthorizationParams) =>
    request<OAuthAuthorizationRequestResponse>(
      `/oauth/authorization-request?${authorizationQuery(params)}`,
    ),

  /**
   * "Allow". Answers with the code, the URI it must be delivered to, and the
   * state to echo — and the page redirects to exactly that URI, never to the one
   * in its own query string.
   */
  approveAuthorization: (params: OAuthAuthorizationParams) =>
    request<ApproveAuthorizationResponse>('/oauth/authorize', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  /** What the caller has let in: every app authorized on their account. */
  listOAuthConnections: () =>
    request<ListOAuthConnectionsResponse>('/oauth/connections'),

  /**
   * Disconnects an app: the authorization and every token it holds for this
   * account, so it stops working on its next call rather than within the hour.
   */
  deleteOAuthConnection: (appId: string) =>
    request<void>(`/oauth/connections/${appId}`, { method: 'DELETE' }),

  /**
   * Every key made for an organization, whoever made it. An admin's list: keys
   * outlive the people who made them, and somebody has to be able to cut one off.
   */
  listOrganizationApiKeys: (orgId: string) =>
    request<ListOrganizationApiKeysResponse>(`/organizations/${orgId}/api-keys?limit=100`),

  /** Revokes one of the organization's keys, whoever made it. Deletes it too. */
  revokeOrganizationApiKey: (orgId: string, keyId: string) =>
    request<void>(`/organizations/${orgId}/api-keys/${keyId}`, { method: 'DELETE' }),

  /**
   * The caller's own profile: what to call them, what they say about
   * themselves, and their links.
   *
   * Read rather than created on the client's side — the API answers for an
   * account that has never opened this screen too, naming it as the identity
   * provider named it, because a course page that credits nobody credits
   * nothing. Adding the row is the API's business.
   */
  getMyProfile: () => request<ProfileResponse>('/me/profile'),

  /** Edits it. Only the fields sent are written; `''` clears one. */
  updateMyProfile: (payload: UpdateProfilePayload) =>
    request<ProfileResponse>('/me/profile', { method: 'PUT', body: JSON.stringify(payload) }),

  /** Reserves a photo upload and points the profile at it, as a cover does. */
  uploadProfilePhoto: (payload: { contentType: string; size?: number }) =>
    request<UploadProfilePhotoResponse>('/me/profile/photo', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};

/**
 * An authorization request as a query string.
 *
 * `undefined` values are dropped rather than sent as the string `undefined` —
 * `state` and `scope` are both optional, and a request that carried
 * `scope=undefined` would be one the API refuses for naming a scope nobody has
 * ever heard of.
 */
function authorizationQuery(params: OAuthAuthorizationParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  return query.toString();
}
