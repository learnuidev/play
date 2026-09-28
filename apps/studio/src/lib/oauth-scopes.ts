import type { ApiScope } from '@play/types';

/**
 * What each scope is called when a person reads it.
 *
 * The ids live in `@play/types` and are the API's; this is the copy beside them,
 * and it belongs to the app because it is written for a person deciding
 * something rather than for a program. Two screens use it and that is why it is
 * one file: the consent screen, where these sentences are the whole of what
 * somebody is agreeing to, and the app form, where an author is choosing what
 * their app may ask for.
 *
 * The rules the copy follows, because a consent screen is a legal-ish document
 * written in plain language and it is easy to get wrong:
 *
 * - **Second person, and about the person's data.** "See your profile", not
 *   "Read profile scope" and not "Profile access". Somebody is deciding what an
 *   app may do on *their* account.
 * - **A verb, not a noun.** "Read the published catalog" says what happens;
 *   "catalog:read" says what the server checks.
 * - **The description says what is *not* included when that is the point.** The
 *   difference between reading a course and playing its video is exactly the
 *   kind of thing a person needs told rather than left to infer.
 */
export interface ScopeCopy {
  /** The heading on a consent screen and in the app form. */
  title: string;
  /** One sentence of detail under it. */
  description: string;
}

export const OAUTH_SCOPE_COPY: Record<ApiScope, ScopeCopy> = {
  'profile:read': {
    title: 'See your profile',
    description: 'Your name, your photo, the sentence you wrote about yourself, and your links.',
  },
  'courses:read': {
    title: 'Read the published catalog',
    description: 'Courses their authors have listed, with what each one says about itself.',
  },
  'lessons:read': {
    title: 'Read course outlines and lessons',
    description:
      'A course’s sections, its lesson titles, and the files attached to a lesson — including courses that are not published, when you can read them yourself.',
  },
  'lessons:stream': {
    title: 'Play lesson videos',
    description:
      'Signed links to the video and the subtitles. Separate from reading a course because serving video is what costs money.',
  },
  'organization:courses:read': {
    title: 'Read the courses of an organization',
    description:
      'This is the only permission that reaches anything unpublished. The app reads only organizations you are already a member of.',
  },
  'learning:read': {
    title: 'See your progress and your saved lessons',
    description:
      'Which lessons you have finished, and which you have saved to your favourites. Yours alone — no other account is reachable this way.',
  },
  'learning:write': {
    title: 'Mark lessons complete, and save them',
    description:
      'Changes your own learning record: finishing a lesson, or adding one to your favourites. It cannot touch anybody else’s, and it cannot delete a lesson or a course.',
  },
  'comments:write': {
    title: 'Post comments as you',
    description:
      'Anything it posts appears under your name, in the discussion on a lesson. Editing and deleting stay in Play, where you are the one reading them.',
  },
};

/**
 * The scopes a new app starts with, as the form's initial answer.
 *
 * A copy of the API's `DEFAULT_OAUTH_SCOPES` rather than an import, because the
 * form's initial state and the API's default have different jobs: the API
 * refuses a registration with no scopes at all, and this is what the checkboxes
 * start out as. They happen to agree today, and the API is what is enforced.
 */
export const DEFAULT_APP_SCOPE_SELECTION: ApiScope[] = [
  'profile:read',
  'courses:read',
  'lessons:read',
];
