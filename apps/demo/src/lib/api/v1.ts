import type {
  ApiCompletionResponse,
  ApiFavouriteResponse,
  ApiIdentityResponse,
  ApiLearningResponse,
  ApiLessonCommentResponse,
  ApiLessonCommentsResponse,
  ApiLesson,
  ApiLessonAttachmentsResponse,
  ApiLessonResponse,
  ApiLessonStreamResponse,
  ApiLessonSubtitlesResponse,
  ApiProfileResponse,
  ApiSectionsResponse,
  CatalogCourse,
  CatalogCourseResponse,
  CatalogSection,
  ListCatalogResponse,
} from '@play/types';
import { API_BASE_URL } from '@/lib/oauth/config';
import { currentAccessToken } from '@/lib/oauth/store';

/**
 * The public API, as this app uses it.
 *
 * Twelve calls, and the file is worth reading top to bottom because that is the
 * entire surface a third-party app has. The reads: the catalog, a course and its
 * outline, a lesson, its video, its subtitles, its attachments, who the
 * credential is, who is behind it, and what that person has saved and finished.
 * The writes: marking a lesson complete, saving one to their favourites, and
 * posting a comment under their name.
 *
 * What makes any of it *personal* is the token: it acts as the person who
 * authorized this app, so the courses listed are the ones they can read, the
 * record written is their own, and a comment posted is theirs by name. The writes
 * are the three calls at the bottom, and every one of them needs a scope the
 * person agreed to on a consent screen.
 *
 * Every call goes through `v1()`, which is where what they all share lives:
 * presenting the access token, and renewing it once if the answer is 401.
 */

/** An HTTP failure, carrying the API's own message so a page can print it. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * One authenticated read.
 *
 * The 401 retry is not defensive padding: an access token lasts an hour, so the
 * ordinary life of a page that has been open a while includes exactly one
 * request made with a credential that expired since the last one. Renewing and
 * trying again is what makes that invisible — and it is safe to do here, because
 * everything under `/v1` is a read and a repeated one costs nothing but a
 * round trip.
 *
 * A 403 is *not* retried. It means the token is fine and the scopes are not —
 * the person authorized this app for less than this call needs — and asking
 * again with a newer token would give the same answer.
 */
async function v1<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = async (token: string | null) =>
    fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  let response = await send(await currentAccessToken());

  if (response.status === 401) {
    response = await send(await currentAccessToken());
  }

  if (!response.ok) {
    let message = `The API answered ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // A body that is not JSON is not a reason to lose the status, which is the
      // part a page acts on.
    }
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}

/** Who the credential is, what it reaches, and which app it belongs to. */
export async function getIdentity(): Promise<ApiIdentityResponse> {
  return v1<ApiIdentityResponse>('/v1/me');
}

/** The person behind the credential. Needs `profile:read`, and says so if not. */
export async function getProfile(): Promise<ApiProfileResponse> {
  return v1<ApiProfileResponse>('/v1/me/profile');
}

/**
 * What this person has saved and finished.
 *
 * The read that makes the two write calls above worth having: an app that can
 * mark a lesson complete and cannot see which lessons are complete draws a
 * checkbox that lies, and the same goes for a heart. One response, both lists.
 */
export async function getMyLearning(): Promise<ApiLearningResponse> {
  return v1<ApiLearningResponse>('/v1/me/learning');
}

/** The published catalog. */
export async function listCourses(limit = 24): Promise<CatalogCourse[]> {
  const response = await v1<ListCatalogResponse>(`/v1/courses?limit=${limit}`);
  return response.courses;
}

/** One listed course: what it is, who teaches it, and its whole outline. */
export async function getCourse(spaceId: string): Promise<CatalogCourseResponse> {
  return v1<CatalogCourseResponse>(`/v1/courses/${encodeURIComponent(spaceId)}`);
}

/**
 * A course's outline, whether or not anybody published it.
 *
 * The difference from `getCourse` is the one this API makes a point of: this
 * route is authorized by *access* rather than by publication, so it answers for
 * a course the person can read even when the catalog would 404. This app asks
 * for it when the catalog does not know the course, which is what lets the
 * classroom open somebody's own unpublished course.
 */
export async function getSections(spaceId: string): Promise<CatalogSection[]> {
  const response = await v1<ApiSectionsResponse>(
    `/v1/courses/${encodeURIComponent(spaceId)}/sections`,
  );
  return response.sections;
}

/** One lesson: its title, the author's notes, and enough to draw the page. */
export async function getLesson(contentId: string): Promise<ApiLesson> {
  const response = await v1<ApiLessonResponse>(`/v1/lessons/${encodeURIComponent(contentId)}`);
  return response.lesson;
}

/** How to play it: a signed HLS manifest, and the query every segment needs. */
export async function getStream(contentId: string): Promise<ApiLessonStreamResponse> {
  return v1<ApiLessonStreamResponse>(`/v1/lessons/${encodeURIComponent(contentId)}/stream`);
}

/** The subtitle tracks, each with a signed URL, and the words behind them. */
export async function getSubtitles(contentId: string): Promise<ApiLessonSubtitlesResponse> {
  return v1<ApiLessonSubtitlesResponse>(`/v1/lessons/${encodeURIComponent(contentId)}/subtitles`);
}

/** The worksheets and slides beside the video. */
export async function getAttachments(contentId: string): Promise<ApiLessonAttachmentsResponse> {
  return v1<ApiLessonAttachmentsResponse>(
    `/v1/lessons/${encodeURIComponent(contentId)}/attachments`,
  );
}

/** A course as a card draws it, for the catalog list. */
export type CourseCard = CatalogCourse;

/* ------------------------------------------------------------------ writing */

/**
 * Mark a lesson done, or take it back off the list.
 *
 * One call with a method rather than two functions, because it is one piece of
 * state and a checkbox is doing the same thing either way — the same reason the
 * API models it as one resource with `PUT` and `DELETE`.
 */
export async function setLessonCompletion(
  contentId: string,
  completed: boolean,
): Promise<ApiCompletionResponse> {
  return v1<ApiCompletionResponse>(`/v1/lessons/${encodeURIComponent(contentId)}/completion`, {
    method: completed ? 'PUT' : 'DELETE',
  });
}

/** Save a lesson to the authorizer's favourites, or unsave it. */
export async function setLessonFavourite(
  contentId: string,
  favourited: boolean,
): Promise<ApiFavouriteResponse> {
  return v1<ApiFavouriteResponse>(`/v1/lessons/${encodeURIComponent(contentId)}/favourite`, {
    method: favourited ? 'PUT' : 'DELETE',
  });
}

/**
 * The discussion on a lesson: every top-level comment with its replies.
 *
 * Read with `lessons:read` and nothing else — anybody who may read a lesson may
 * read what was said about it. The threads arrive already assembled, because the
 * two-level rule (a reply always carries the thread's *root*, however deep the
 * conversation looks) is the API's invariant, and nesting rows by hand is how a
 * client gets it wrong.
 */
export async function getLessonComments(contentId: string): Promise<ApiLessonCommentsResponse> {
  return v1<ApiLessonCommentsResponse>(`/v1/lessons/${encodeURIComponent(contentId)}/comments`);
}

/**
 * Post a comment on a lesson, as the person who authorized this app — or reply
 * to one.
 *
 * The one call in this file that puts somebody's name on something, and the only
 * write with no undo: the API has no edit and no delete, so a comment posted
 * here is withdrawn in Play, by the person whose name is on it.
 *
 * `parentId` is the comment being answered — the thread's root comes back in the
 * response, worked out by the API rather than by this app.
 */
export async function commentOnLesson(
  contentId: string,
  body: string,
  parentId?: string,
): Promise<ApiLessonCommentResponse> {
  return v1<ApiLessonCommentResponse>(`/v1/lessons/${encodeURIComponent(contentId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parentId ? { body, parentId } : { body }),
  });
}
