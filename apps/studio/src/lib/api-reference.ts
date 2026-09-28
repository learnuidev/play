import type { ApiScope } from '@play/types';

/**
 * The API reference, as data.
 *
 * The page renders this; nothing about the layout is in here and nothing about
 * the API is in the page. It is written as one file rather than as prose in the
 * component because a reference is *read* by whoever changes the API: the way to
 * keep the docs true is for the endpoint that changed to be a field somebody has
 * to walk past, in a list they can see the bottom of.
 *
 * Every example is built from the real base URL the app itself calls
 * (`lib/api-base`), so what the page prints is a command that runs.
 */

/**
 * The lists a field's value can be picked from.
 *
 * A ULID is the one thing about this API that cannot be read off the page: the
 * reference says `spaceId` is a course, and nothing on the card says which
 * course. Each of these names a list the studio can already read for the person
 * looking at the page, which the playground offers beside the input — what that
 * costs and where it is read from is `lib/api-choices`.
 */
export type ApiChoiceSource = 'courses' | 'lessons' | 'organizations' | 'keys';

export interface ApiField {
  name: string;
  type: string;
  required?: boolean;
  description: string;
  /** The value used in the generated examples. */
  example?: string;
  /**
   * Set when this field's value names something the reader has one or more of,
   * so the card offers a list of them next to the box. Absent means the value is
   * not an id — a title, a limit, a search term — and there is nothing to list.
   * The field is still typed either way: a picker fills the input, it does not
   * replace it.
   */
  choices?: ApiChoiceSource;
}

export interface ApiParameter extends ApiField {
  in: 'path' | 'query';
}

export interface ApiEndpoint {
  /** The anchor it is linked by, and what the rail scrolls to. */
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  /** One or two sentences on what it is for and anything surprising about it. */
  description: string;
  /**
   * What authenticates the call. Four kinds of caller reach this service and the
   * difference matters to whoever is reading:
   *
   * - `key` — a credential in a header, either an API key or an OAuth access
   *   token. Every route under `/v1` takes both; what changes between them is
   *   what the credential is allowed to reach, which is `scope` below.
   * - `session` — a signed-in person's token, which is what the studio itself
   *   sends. The endpoints that mint and revoke credentials live here, so that a
   *   credential cannot mint another one.
   * - `oauth-client` — a client id and secret, presented by a third party's
   *   server to the token endpoint. Not a person and not a key: an app
   *   authenticating *itself*, before it is given anything to act with.
   * - `browser` — not a call an integration makes at all: a person's browser,
   *   following a redirect, which is what an authorization request is.
   */
  auth: 'key' | 'session' | 'oauth-client' | 'browser';
  parameters?: ApiParameter[];
  body?: ApiField[];
  /** The status it answers with, e.g. `200 OK`. */
  responseStatus: string;
  /**
   * The JSON the endpoint answers with, exactly as it arrives. Absent when the
   * answer is a status and nothing else, which is what a delete is.
   */
  responseExample?: string;
  /** What is in that JSON. Empty when there is no JSON. */
  responseFields?: ApiField[];
  /** Caveats that change how the answer above should be read. */
  notes?: string[];
  /**
   * The scope a call under `/v1` needs, when it needs one.
   *
   * Absent on the two that need none — `GET /v1/me` answers who the caller is
   * whatever they hold, and the endpoints that manage credentials take a session
   * rather than a scope. An API key holds every scope except `profile:read`, so
   * this is what tells an app author which permissions to ask a person for.
   */
  scope?: ApiScope;
  /**
   * How the request body is written. Absent means JSON, which is what every
   * endpoint in this service takes.
   *
   * The one exception is the OAuth endpoints, where RFC 6749 specifies
   * `application/x-www-form-urlencoded` and every OAuth client library sends it:
   * documenting JSON there would be documenting a request no library makes.
   */
  bodyEncoding?: 'json' | 'form';
}

export interface ApiEndpointGroup {
  id: string;
  title: string;
  description: string;
  endpoints: ApiEndpoint[];
}

const COURSE_FIELDS: ApiField[] = [
  { name: 'spaceId', type: 'string', description: 'ULID. What a course is addressed by everywhere else in the API.' },
  { name: 'title', type: 'string', description: 'What the course is called.' },
  { name: 'description', type: 'string', description: 'What it says about itself.' },
  {
    name: 'type',
    type: '"SELF_PACED" | "SCHEDULED"',
    description: 'Self-paced starts when a learner registers; scheduled starts on `startAt`.',
  },
  { name: 'color', type: 'string?', description: 'Custom accent, `#rrggbb`. Absent means the interface derives one.' },
  { name: 'startAt', type: 'number?', description: 'Epoch milliseconds. Only on a scheduled course.' },
  { name: 'dripIntervalDays', type: 'number?', description: 'Days between section unlocks. Only on a scheduled course.' },
  { name: 'thumbnailUrl', type: 'string?', description: 'Signed cover image URL, good for a few minutes. Present only if the course has a cover.' },
  { name: 'organizationId', type: 'string', description: 'The organization the course belongs to.' },
  { name: 'organizationName', type: 'string', description: 'What that organization is called, for drawing a card without a second call.' },
  { name: 'sectionCount', type: 'integer', description: 'How many sections it holds, counted when you ask rather than stored.' },
  { name: 'lessonCount', type: 'integer', description: 'How many lessons it holds.' },
  { name: 'studentCount', type: 'integer', description: 'How many students are registered for it.' },
  { name: 'createdAt', type: 'number', description: 'Epoch milliseconds.' },
];

const NEXT_TOKEN: ApiParameter = {
  in: 'query',
  name: 'nextToken',
  type: 'string',
  description:
    'The page to read next, taken from the previous response. Opaque — pass it back unchanged, and stop when it is absent.',
};

const LIMIT: ApiParameter = {
  in: 'query',
  name: 'limit',
  type: 'integer',
  description: 'How many to return in one page. Defaults to 20, and never more than 100.',
  example: '20',
};

const KEY_FIELDS: ApiField[] = [
  { name: 'keyId', type: 'string', description: 'ULID. The key’s public name — what revokes it, and what a support question quotes.' },
  { name: 'name', type: 'string', description: 'What the key is for, as its owner named it.' },
  { name: 'prefix', type: 'string', description: 'The opening characters of the secret, `play_sk_…`. Enough to tell two keys apart, not enough to use one.' },
  { name: 'createdAt', type: 'number', description: 'Epoch milliseconds.' },
  { name: 'lastUsedAt', type: 'number?', description: 'When it was last presented, accurate to about five minutes. Absent until it is used.' },
  { name: 'organizationId', type: 'string?', description: 'The organization it was made for, when its creator named one.' },
  { name: 'organizationName', type: 'string?', description: 'That organization’s name, so a list needs no second call.' },
];

const ORGANIZATION_KEY_FIELDS: ApiField[] = [
  ...KEY_FIELDS,
  { name: 'userId', type: 'string', description: 'Cognito `sub` of the person who made the key — which is who it acts as.' },
  { name: 'userEmail', type: 'string?', description: 'Their email at the time, so an admin list can be read by a person.' },
];

/**
 * An app, as its owner reads it. The client id is public by definition — it
 * travels in a URL a browser can see — and the secret is not on this shape at
 * all: the service keeps a hash, so the full secret exists once, in the response
 * that created it or the one that rotated it.
 */
const OAUTH_APP_FIELDS: ApiField[] = [
  { name: 'appId', type: 'string', description: 'ULID. What addresses the app in the studio, and in the paths above.' },
  { name: 'clientId', type: 'string', description: 'The public half of the credential, `play_app_…`. Sent to the authorization page and to the token endpoint.' },
  { name: 'name', type: 'string', description: 'What the app is called on the consent screen.' },
  { name: 'description', type: 'string', description: 'The sentence under the name on the consent screen.' },
  { name: 'homepageUrl', type: 'string?', description: 'Where the app lives, linked from the consent screen.' },
  { name: 'logoUrl', type: 'string?', description: 'The app’s mark on the consent screen and the connections screen.' },
  { name: 'redirectUris', type: 'array', description: 'Where the app may be sent back to, matched exactly. `https` anywhere, `http` only on localhost, or a native app’s own scheme.' },
  { name: 'scopes', type: 'array', description: 'The most the app may ever ask a person for.' },
  { name: 'isPublic', type: 'boolean', description: 'True when the app has no secret and authenticates with PKCE alone.' },
  { name: 'clientSecretPrefix', type: 'string?', description: 'The opening characters of the secret, `play_cs_…`. Absent on a public client, which has none.' },
  { name: 'createdAt', type: 'number', description: 'Epoch milliseconds.' },
  { name: 'updatedAt', type: 'number', description: 'Epoch milliseconds. Moves when any setting does.' },
];

export const API_ENDPOINT_GROUPS: ApiEndpointGroup[] = [
  {
    id: 'account',
    title: 'The credential itself',
    description:
      'What the credential you are holding is, and who it acts as. Behind either credential, like everything under /v1.',
    endpoints: [
      {
        id: 'get-me',
        method: 'GET',
        path: '/v1/me',
        summary: 'Check a credential, and see everything it reaches.',
        description:
          'The first call to make with a new credential, and the one that answers both questions its holder has: does this work, and what does it unlock. It answers for either kind — an API key or an OAuth access token — and `kind` says which one you are holding. It needs no scope, which is the point: a credential that has run out of permission still has to be able to find out what it is.',
        auth: 'key',
        responseStatus: '200 OK',
        responseExample: `{
  "kind": "oauth",
  "oauth": {
    "app": {
      "appId": "01JQ9B7M5N8P1Q4R7T0V3W6X9Y",
      "clientId": "play_app_7c1d9e2f4a6b8c0d",
      "name": "Team dashboard",
      "description": "Shows your team's courses and progress in one place."
    },
    "scopes": ["profile:read", "courses:read", "lessons:read"],
    "scope": "profile:read courses:read lessons:read"
  },
  "owner": {
    "userId": "8f14e45f-ea6c-4f2b-9d3a-1c2b3a4d5e6f"
  },
  "scopes": ["profile:read", "courses:read", "lessons:read"]
}`,
        responseFields: [
          { name: 'kind', type: '"key" | "oauth"', description: 'Which credential authenticated the call.' },
          { name: 'key', type: 'object?', description: 'The key, when `kind` is `key`. Absent otherwise. It has the fields of any other key: `keyId`, `name`, `prefix`, `createdAt`, `lastUsedAt`, and the organization it was made for.' },
          { name: 'oauth.app', type: 'object?', description: 'The app the token was issued to, when `kind` is `oauth`: its `appId`, `clientId`, `name` and `description`.' },
          { name: 'oauth.scopes', type: 'array?', description: 'What the token was issued with — the permissions a person agreed to on a consent screen.' },
          { name: 'oauth.scope', type: 'string?', description: 'The same list, space-delimited, spelled the way OAuth spells it.' },
          { name: 'owner.userId', type: 'string', description: 'Cognito `sub` of the person the credential acts as. Every read is attributed to them.' },
          { name: 'scopes', type: 'array', description: 'Every scope the credential holds. Empty for an API key unless its owner named an organization.' },
        ],
      },
      {
        id: 'get-me-profile',
        method: 'GET',
        path: '/v1/me/profile',
        summary: 'Who the person behind the credential is.',
        description:
          'A name, a photo, a sentence and a set of links — the same public half of a profile a marketplace course page credits an instructor with. It is what makes an integration feel like part of the product rather than a script holding a token: an app that knows a name can greet somebody by it. Behind `profile:read`, because a name is a person and a catalog is not, and somebody reading a consent screen can tell those two apart.',
        auth: 'key',
        scope: 'profile:read',
        responseStatus: '200 OK',
        responseExample: `{
  "profile": {
    "userId": "8f14e45f-ea6c-4f2b-9d3a-1c2b3a4d5e6f",
    "name": "Dana Ruiz",
    "bio": "Teaches film editing, badly but enthusiastically.",
    "socials": {
      "website": "https://dana.example"
    },
    "photoUrl": "https://videos.example.net/people/8f14e45f/photo-1772582400000.jpg?Policy=…"
  }
}`,
        responseFields: [
          { name: 'profile.userId', type: 'string', description: 'Cognito `sub`. The same id `GET /v1/me` reports as `owner.userId`.' },
          { name: 'profile.name', type: 'string', description: 'What they call themselves. Never empty.' },
          { name: 'profile.bio', type: 'string', description: 'The sentence they wrote about themselves. Empty when they have not written one.' },
          { name: 'profile.socials', type: 'object', description: 'Their links, keyed by kind. Empty when they have added none.' },
          { name: 'profile.photoUrl', type: 'string?', description: 'A signed URL, minted per response and good for a few minutes. Absent when they have no photo.' },
        ],
        notes: [
          'No email, and no timestamps. What this endpoint answers with is what this service shows a stranger on a course page, because a consent screen cannot ask somebody to agree to something they cannot see.',
          'An API key never holds `profile:read`, so this endpoint answers a key with **403**. A key belongs to a script, and no person agreed to anything on their own behalf when it was made.',
        ],
      },
    ],
  },
  {
    id: 'catalog',
    title: 'The published catalog',
    description:
      'Courses their authors have published, and the syllabus of each one. The same courses the marketplace shows a visitor who has not signed in.',
    endpoints: [
      {
        id: 'list-courses',
        method: 'GET',
        path: '/v1/courses',
        summary: 'List the published courses, newest first.',
        description:
          'One page of the catalog, or a search across it. With `query` the API searches instead of paging: it reads a bounded stretch of the catalog and matches a case-insensitive substring against each course’s title, its description, and the name of the community it is from.',
        auth: 'key',
        scope: 'courses:read',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'query',
            name: 'query',
            type: 'string',
            description:
              'Search the catalog instead of browsing it. A search returns no `nextToken` — what comes back is the matches among a bounded read, which is the honest shape for this to have until the catalog is big enough to want a search index of its own.',
            example: 'film',
          },
          LIMIT,
          NEXT_TOKEN,
        ],
        responseExample: `{
  "courses": [
    {
      "spaceId": "01JQ8Y4C2D5F7H9K1M3P5R7T9V",
      "title": "Introduction to Film",
      "description": "Eight weeks of how a film is put together, from the first shot to the last cut.",
      "type": "SELF_PACED",
      "color": "#6366f1",
      "organizationId": "01JQ8Y2A1B3C4D5E6F7G8H9J0K",
      "organizationName": "Northwind Learning",
      "thumbnailUrl": "https://d111111abcdef8.cloudfront.net/spaces/01JQ8Y4C/cover.jpg?Policy=…&Signature=…&Key-Pair-Id=…",
      "sectionCount": 6,
      "lessonCount": 24,
      "studentCount": 128,
      "createdAt": 1771977600000
    }
  ],
  "nextToken": "eyJzcGFjZUlkIjoiMDFKUThZ…"
}`,
        responseFields: [
          { name: 'courses', type: 'array', description: 'The page of courses, newest first.' },
          ...COURSE_FIELDS.map((field) => ({ ...field, name: `courses[].${field.name}` })),
          { name: 'nextToken', type: 'string?', description: 'Pass this back as `nextToken` to read the next page. Absent on the last page, and always absent from a search.' },
        ],
        notes: [
          'An empty `courses` array with no `nextToken` means the catalog is empty, not that the search failed.',
        ],
      },
      {
        id: 'get-course',
        method: 'GET',
        path: '/v1/courses/{spaceId}',
        summary: 'One published course, with its syllabus.',
        description:
          'What a course is, and what is in it: its sections and their lessons, in the order they are taught. The lessons themselves are not here — a lesson’s video, notes, files and discussion are what registering for the course is *for*, and they stay behind the course’s own membership.',
        auth: 'key',
        scope: 'courses:read',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'spaceId',
            type: 'string',
            required: true,
            choices: 'courses',
            description: 'The course to read, as returned by the list endpoint.',
            example: '01JQ8Y4C2D5F7H9K1M3P5R7T9V',
          },
        ],
        responseExample: `{
  "course": {
    "spaceId": "01JQ8Y4C2D5F7H9K1M3P5R7T9V",
    "title": "Introduction to Film",
    "type": "SELF_PACED",
    "organizationName": "Northwind Learning",
    "sectionCount": 2,
    "lessonCount": 3,
    "studentCount": 128,
    "createdAt": 1771977600000
  },
  "sections": [
    {
      "sectionId": "01JQ8Y6E4F7H9K1M3P5R7T9V1X",
      "title": "Before the camera",
      "lessons": [
        { "contentId": "01JQ8Y8G6H9K1M3P5R7T9V1X3Z", "title": "What a shot is", "hasVideo": true }
      ]
    }
  ]
}`,
        responseFields: [
          { name: 'course', type: 'object', description: 'The course, in the same shape the list returns.' },
          { name: 'sections', type: 'array', description: 'Its sections, in teaching order.' },
          { name: 'sections[].sectionId', type: 'string', description: 'ULID of the section.' },
          { name: 'sections[].title', type: 'string', description: 'The section’s heading.' },
          { name: 'sections[].lessons', type: 'array', description: 'The lessons filed under it, in order.' },
          { name: 'sections[].lessons[].contentId', type: 'string', description: 'ULID of the lesson.' },
          { name: 'sections[].lessons[].title', type: 'string', description: 'What the lesson is called.' },
          { name: 'sections[].lessons[].hasVideo', type: 'boolean', description: 'Whether the lesson plays a video. The video’s id is not published: it is behind the course’s membership.' },
        ],
        notes: [
          'A course that exists but has not been published answers **404**, not 403 — the catalog does not report which course ids exist in private.',
        ],
      },
    ],
  },
  {
    id: 'organizations',
    title: 'An organization’s courses',
    description:
      'What a key made for an organization reaches that the public catalog does not: its whole catalogue, published or not.',
    endpoints: [
      {
        id: 'list-organization-courses',
        method: 'GET',
        path: '/v1/organizations/{orgId}/courses',
        summary: 'List an organization’s courses, including unpublished ones.',
        description:
          'The read that makes naming an organization on a key worth doing. A partner integrating with one customer gets that customer’s entire catalogue — the courses written for a team, the drafts, the ones nobody has listed — rather than the subset advertised to the world. Courses come back in the same shape the catalog list returns.',
        auth: 'key',
        scope: 'organization:courses:read',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'orgId',
            type: 'string',
            required: true,
            choices: 'organizations',
            description: 'The organization. The key must have been made for it.',
            example: '01JQ8Y2A1B3C4D5E6F7G8H9J0K',
          },
          LIMIT,
          NEXT_TOKEN,
        ],
        responseExample: `{
  "courses": [
    {
      "spaceId": "01JQ8Y4C2D5F7H9K1M3P5R7T9V",
      "title": "Introduction to Film",
      "organizationId": "01JQ8Y2A1B3C4D5E6F7G8H9J0K",
      "organizationName": "Northwind Learning",
      "sectionCount": 6,
      "lessonCount": 24,
      "studentCount": 128,
      "createdAt": 1771977600000
    }
  ],
  "nextToken": "eyJzcGFjZUlkIjoiMDFKUThZ…"
}`,
        responseFields: [
          { name: 'courses', type: 'array', description: 'The organization’s courses, newest first. Unpublished ones are included.' },
          ...COURSE_FIELDS.map((field) => ({ ...field, name: `courses[].${field.name}` })),
          { name: 'nextToken', type: 'string?', description: 'The next page, when there is one.' },
        ],
        notes: [
          'A key made for one organization is not a key for every organization. Asking about any other answers **403** rather than an empty list, so an integration wired up to the wrong organization says so instead of reporting that its customer has no courses.',
        ],
      },
    ],
  },
  {
    id: 'lessons',
    title: 'A lesson',
    description:
      'The pieces a page needs to teach with, in the order it needs them: the outline the lesson sits in, the lesson itself, its video, its subtitles and its attachments. These are authorized by **access** rather than by publication — a key reaches what its owner may read, and a key made for an organization reaches everything that organization owns.',
    endpoints: [
      {
        id: 'list-course-sections',
        method: 'GET',
        path: '/v1/courses/{spaceId}/sections',
        summary: 'The outline of a course you can read, published or not.',
        description:
          'The same shape the syllabus uses — sections, and each lesson’s title and whether it has a video — with one difference that is the whole reason this endpoint exists: it answers for any course the key may read. `GET /v1/courses/{spaceId}` is the catalogue and answers only for a published course; this is the left rail of a classroom, which has to work for the ones nobody has advertised.',
        auth: 'key',
        scope: 'lessons:read',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'spaceId',
            type: 'string',
            required: true,
            choices: 'courses',
            description: 'The course to outline.',
            example: '01JQ8Y4C2D5F7H9K1M3P5R7T9V',
          },
        ],
        responseExample: `{
  "sections": [
    {
      "sectionId": "01JQ8Y6E4F7H9K1M3P5R7T9V1X",
      "title": "Before the camera",
      "lessons": [
        { "contentId": "01JQ8Y8G6H9K1M3P5R7T9V1X3Z", "title": "What a shot is", "hasVideo": true },
        { "contentId": "01JQ8Y8G6H9K1M3P5R7T9V1X40", "title": "Reading a scene", "hasVideo": false }
      ]
    }
  ]
}`,
        responseFields: [
          { name: 'sections', type: 'array', description: 'The course’s sections, in teaching order.' },
          { name: 'sections[].sectionId', type: 'string', description: 'ULID of the section.' },
          { name: 'sections[].title', type: 'string', description: 'The section’s heading.' },
          { name: 'sections[].lessons', type: 'array', description: 'Its lessons, in order.' },
          { name: 'sections[].lessons[].contentId', type: 'string', description: 'What `/v1/lessons/{contentId}` takes.' },
          { name: 'sections[].lessons[].title', type: 'string', description: 'What the lesson is called.' },
          { name: 'sections[].lessons[].hasVideo', type: 'boolean', description: 'Whether there is a video to ask `/stream` for.' },
        ],
      },
      {
        id: 'get-lesson',
        method: 'GET',
        path: '/v1/lessons/{contentId}',
        summary: 'One lesson: its title, its notes, and its poster.',
        description:
          'What a lesson is, apart from its media. The notes come back as the document the author wrote — a ProseMirror tree, the same one the classroom renders — rather than as HTML, because this API does not sanitize markup for a caller and a document is not a string anybody has to trust. The poster is here so a page has something to draw before the manifest arrives.',
        auth: 'key',
        scope: 'lessons:read',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'contentId',
            type: 'string',
            required: true,
            choices: 'lessons',
            description: 'The lesson, from the outline above.',
            example: '01JQ8Y8G6H9K1M3P5R7T9V1X3Z',
          },
        ],
        responseExample: `{
  "lesson": {
    "contentId": "01JQ8Y8G6H9K1M3P5R7T9V1X3Z",
    "spaceId": "01JQ8Y4C2D5F7H9K1M3P5R7T9V",
    "sectionId": "01JQ8Y6E4F7H9K1M3P5R7T9V1X",
    "title": "What a shot is",
    "notes": { "type": "doc", "content": [] },
    "videoId": "01JQ8Y9H7K1M3P5R7T9V1X3Z5B",
    "thumbnailUrl": "https://d111111abcdef8.cloudfront.net/thumbnails/…?Policy=…&Signature=…",
    "fileCount": 2,
    "position": 1,
    "createdAt": 1771977600000,
    "updatedAt": 1772064000000
  }
}`,
        responseFields: [
          { name: 'lesson.contentId', type: 'string', description: 'ULID of the lesson.' },
          { name: 'lesson.spaceId', type: 'string', description: 'The course it belongs to.' },
          { name: 'lesson.sectionId', type: 'string', description: 'The section it is filed under.' },
          { name: 'lesson.title', type: 'string', description: 'What it is called.' },
          { name: 'lesson.notes', type: 'object?', description: 'The author’s notes as a ProseMirror document. Render it with an editor; do not treat it as markup.' },
          { name: 'lesson.videoId', type: 'string?', description: 'The video it plays, when it has one. Absent on a lesson that is reading only.' },
          { name: 'lesson.thumbnailUrl', type: 'string?', description: 'Signed poster URL, when the video has one.' },
          { name: 'lesson.fileCount', type: 'integer', description: 'How many attachments it has. `/attachments` returns them.' },
          { name: 'lesson.position', type: 'integer', description: '1-based order inside its section.' },
          { name: 'lesson.createdAt', type: 'number', description: 'Epoch milliseconds.' },
          { name: 'lesson.updatedAt', type: 'number', description: 'Epoch milliseconds.' },
        ],
      },
      {
        id: 'get-lesson-stream',
        method: 'GET',
        path: '/v1/lessons/{contentId}/stream',
        summary: 'A signed HLS manifest URL for the lesson’s video.',
        description:
          'How to play it. The manifest is signed per request, so a lesson’s video is reachable only by somebody who may read the lesson — and `baseUrl` and `signedQuery` come back beside the URL because the signature covers the video’s whole stream prefix rather than one file. A player has to attach that same query to every segment it asks for, which is the one thing it cannot work out from the manifest alone.',
        auth: 'key',
        scope: 'lessons:stream',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'contentId',
            type: 'string',
            required: true,
            choices: 'lessons',
            description: 'The lesson whose video to play.',
            example: '01JQ8Y8G6H9K1M3P5R7T9V1X3Z',
          },
        ],
        responseExample: `{
  "videoId": "01JQ8Y9H7K1M3P5R7T9V1X3Z5B",
  "manifestUrl": "https://d111111abcdef8.cloudfront.net/processed/01JQ8Y9H7K1M3P5R7T9V1X3Z5B/hls/master.m3u8?Policy=…&Signature=…&Key-Pair-Id=…",
  "baseUrl": "https://d111111abcdef8.cloudfront.net/processed/01JQ8Y9H7K1M3P5R7T9V1X3Z5B/hls/master.m3u8",
  "signedQuery": "Policy=…&Signature=…&Key-Pair-Id=…",
  "expiresAt": 1772669700
}`,
        responseFields: [
          { name: 'videoId', type: 'string', description: 'The video behind the manifest.' },
          { name: 'manifestUrl', type: 'string', description: 'The signed HLS master playlist. Hand this to the player.' },
          { name: 'baseUrl', type: 'string', description: 'The same URL unsigned — for building sibling requests.' },
          { name: 'signedQuery', type: 'string', description: 'Attach this to every segment and rendition request; the signature covers the whole prefix.' },
          { name: 'expiresAt', type: 'number', description: 'Expiry in epoch **seconds**. Refetch the stream rather than holding a page open past it.' },
        ],
        notes: [
          'A lesson with no video answers **404**. One whose video is still encoding, or whose encoding failed, answers **409** with the status — which is a state a page can say something about, where an empty manifest URL is not.',
        ],
      },
      {
        id: 'get-lesson-subtitles',
        method: 'GET',
        path: '/v1/lessons/{contentId}/subtitles',
        summary: 'Signed WebVTT tracks, and the transcript that goes with them.',
        description:
          'Every ready track — the language it was transcribed in, and any translation the author generated — as a signed WebVTT URL for whatever player you use. `words` is the other half of the same recording: each word with when it is said, which is what lets a transcript highlight as it is read rather than appearing a line at a time.',
        auth: 'key',
        scope: 'lessons:stream',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'contentId',
            type: 'string',
            required: true,
            choices: 'lessons',
            description: 'The lesson whose subtitles to read.',
            example: '01JQ8Y8G6H9K1M3P5R7T9V1X3Z',
          },
        ],
        responseExample: `{
  "videoId": "01JQ8Y9H7K1M3P5R7T9V1X3Z5B",
  "status": "READY",
  "sourceLanguage": "en-US",
  "tracks": [
    {
      "language": "en-US",
      "label": "English",
      "isSource": true,
      "subtitleUrl": "https://d111111abcdef8.cloudfront.net/subtitles/…/source.vtt?Policy=…&Signature=…",
      "baseUrl": "https://d111111abcdef8.cloudfront.net/subtitles/…/source.vtt",
      "signedQuery": "Policy=…&Signature=…&Key-Pair-Id=…",
      "expiresAt": 1772669700
    }
  ],
  "words": [
    { "w": "A", "s": 0, "e": 120 },
    { "w": "shot", "s": 120, "e": 460 }
  ]
}`,
        responseFields: [
          { name: 'videoId', type: 'string?', description: 'Null when the lesson has no video at all.' },
          { name: 'status', type: 'string', description: '`NONE`, `GENERATING`, `READY` or `FAILED` — whether captions exist yet, so a page can say “coming” rather than show nothing.' },
          { name: 'sourceLanguage', type: 'string?', description: 'The language it was transcribed in, when there are tracks.' },
          { name: 'tracks', type: 'array', description: 'One per ready language. Empty when there are none.' },
          { name: 'tracks[].language', type: 'string', description: 'BCP-47 code, e.g. `en-US`, `zh-CN`.' },
          { name: 'tracks[].label', type: 'string', description: 'Human-readable, e.g. `English`.' },
          { name: 'tracks[].isSource', type: 'boolean', description: 'True for the track it was transcribed in, false for a translation.' },
          { name: 'tracks[].subtitleUrl', type: 'string', description: 'The signed WebVTT file.' },
          { name: 'tracks[].signedQuery', type: 'string', description: 'As with the stream: the signature covers the prefix.' },
          { name: 'tracks[].expiresAt', type: 'number', description: 'Expiry in epoch seconds.' },
          { name: 'words', type: 'array?', description: 'Each word with `w`, and `s`/`e` in milliseconds from the start of the video. Capped; absent when the video has no timings.' },
        ],
        notes: [
          'A lesson whose subtitles are still being generated answers **200** with its status and no tracks, rather than an error — “no captions yet” is a state a page renders, not a failure it has to catch.',
        ],
      },
      {
        id: 'list-lesson-attachments',
        method: 'GET',
        path: '/v1/lessons/{contentId}/attachments',
        summary: 'The worksheets and files beside the video.',
        description:
          'Everything attached to the lesson, each with a signed URL. They are signed under one policy scoped to the lesson’s own prefix, so a single signature serves every file — which is also why the whole list comes back at once rather than paged: a lesson’s material is a handful of files.',
        auth: 'key',
        scope: 'lessons:read',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'contentId',
            type: 'string',
            required: true,
            choices: 'lessons',
            description: 'The lesson whose attachments to list.',
            example: '01JQ8Y8G6H9K1M3P5R7T9V1X3Z',
          },
        ],
        responseExample: `{
  "attachments": [
    {
      "fileId": "01JQ8YBJ9M3P5R7T9V1X3Z5B7D",
      "name": "shot-list.pdf",
      "contentType": "application/pdf",
      "size": 182734,
      "url": "https://d111111abcdef8.cloudfront.net/contents/…/shot-list.pdf?Policy=…&Signature=…",
      "createdAt": 1771977600000
    }
  ],
  "expiresAt": 1772669700
}`,
        responseFields: [
          { name: 'attachments', type: 'array', description: 'The lesson’s files. Empty when it has none.' },
          { name: 'attachments[].fileId', type: 'string', description: 'ULID, unique within the lesson.' },
          { name: 'attachments[].name', type: 'string', description: 'The file’s name as it was uploaded — what to save it as.' },
          { name: 'attachments[].contentType', type: 'string', description: 'MIME type, so a caller knows what it is holding.' },
          { name: 'attachments[].size', type: 'number?', description: 'Bytes, when it was recorded at upload.' },
          { name: 'attachments[].url', type: 'string', description: 'Signed download URL.' },
          { name: 'attachments[].createdAt', type: 'number', description: 'Epoch milliseconds.' },
          { name: 'expiresAt', type: 'number', description: 'Expiry in epoch seconds, shared by every URL in the answer.' },
        ],
      },
    ],
  },
  {
    id: 'keys',
    title: 'Managing keys',
    description:
      'The same operations the studio performs when you press Create key or Revoke. These take your **signed-in session**, not an API key: a key cannot mint keys.',
    endpoints: [
      {
        id: 'list-keys',
        method: 'GET',
        path: '/me/api-keys',
        summary: 'Your own keys that still work.',
        description:
          'The keys you hold, newest first. Every row is a key that works: revoking deletes one, so there is no revoked state to return and nothing here that cannot authenticate. The secret itself is never in this response — the API keeps only a hash of it — which is why a key is only ever readable at the moment it is made.',
        auth: 'session',
        responseStatus: '200 OK',
        parameters: [LIMIT, NEXT_TOKEN],
        responseExample: `{
  "keys": [
    {
      "keyId": "01JQ8Z6K4M7N9P2R5T8V1W3X6Y",
      "name": "Nightly reporting",
      "prefix": "play_sk_9f2c1a4b",
      "createdAt": 1772582400000,
      "lastUsedAt": 1772668800000,
      "organizationId": "01JQ8Y2A1B3C4D5E6F7G8H9J0K",
      "organizationName": "Northwind Learning"
    }
  ],
  "nextToken": null
}`,
        responseFields: [
          { name: 'keys', type: 'array', description: 'Your keys, newest first.' },
          ...KEY_FIELDS.map((field) => ({ ...field, name: `keys[].${field.name}` })),
        ],
      },
      {
        id: 'create-key',
        method: 'POST',
        path: '/me/api-keys',
        summary: 'Make a key. The secret comes back once.',
        description:
          'The response carries the secret and it is the only time the API will ever hand one over: what is stored is a SHA-256 of it, so nothing — not an admin, not support, not this endpoint — can read the key back. A caller that loses one revokes it and makes another.',
        auth: 'session',
        responseStatus: '201 Created',
        body: [
          {
            name: 'name',
            type: 'string',
            required: true,
            description: 'What the key is for. 2–60 characters. A name you will recognize in six months, when deciding which key to cut off.',
            example: 'Nightly reporting',
          },
          {
            name: 'organizationId',
            type: 'string',
            choices: 'organizations',
            description:
              'The organization to make the key for. Any active member of it may name it. A key made for an organization appears in that organization’s own list, where its admins can revoke it without asking you — and reaches that organization’s unpublished courses as well as the public catalog.',
            example: '01JQ8Y2A1B3C4D5E6F7G8H9J0K',
          },
        ],
        responseExample: `{
  "key": {
    "keyId": "01JQ8Z6K4M7N9P2R5T8V1W3X6Y",
    "name": "Nightly reporting",
    "prefix": "play_sk_9f2c1a4b",
    "createdAt": 1772582400000,
    "organizationId": "01JQ8Y2A1B3C4D5E6F7G8H9J0K",
    "organizationName": "Northwind Learning"
  },
  "secret": "play_sk_9f2c1a4b7d8e0f1a2b3c4d5e6f7a8b9c"
}`,
        responseFields: [
          { name: 'key', type: 'object', description: 'The key as it will be listed from now on.' },
          { name: 'secret', type: 'string', description: 'The credential itself, shown once and never again. Send it as the `x-api-key` header.' },
        ],
        notes: [
          'One account may hold 25 live keys at a time. Past that, creating one answers **409** and asks you to revoke one first — an unbounded list of keys is an unbounded list of things that can be lost.',
        ],
      },
      {
        id: 'revoke-key',
        method: 'DELETE',
        path: '/me/api-keys/{keyId}',
        summary: 'Revoke one of your own keys.',
        description:
          'Revoking is a hard delete. The key stops authenticating on the next request — nothing is cached in front of the authorizer, and the row the presented secret would have matched is gone — and it is gone from every listing and from the table at the same moment. There is no half state and nothing left to read back, which is why the answer carries no body.',
        auth: 'session',
        responseStatus: '204 No Content',
        parameters: [
          {
            in: 'path',
            name: 'keyId',
            type: 'string',
            required: true,
            choices: 'keys',
            description: 'The key to revoke.',
            example: '01JQ8Z6K4M7N9P2R5T8V1W3X6Y',
          },
        ],
        notes: [
          'The secret is unrecoverable, so a revoked key is not a key that can be brought back: an integration that lost its credential needs a new one, not this one restored.',
          'Revoking a key twice answers **404** the second time. There is no row left to tell an already-revoked key from one that never existed, and nothing about which ids exist is a stranger’s business either.',
        ],
      },
      {
        id: 'list-organization-keys',
        method: 'GET',
        path: '/organizations/{orgId}/api-keys',
        summary: 'The organization’s live keys, whoever made them.',
        description:
          'An admin’s list. Keys outlive the integrations they were made for and often the people who made them, so the question “who still has access to this?” has to be answerable by somebody other than the person holding the key. Revoking deletes a key, so this list is exactly the access that is still live — which is what makes it comparable against the people who should still have it.',
        auth: 'session',
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'orgId',
            type: 'string',
            required: true,
            choices: 'organizations',
            description: 'The organization. The caller must be one of its admins.',
            example: '01JQ8Y2A1B3C4D5E6F7G8H9J0K',
          },
          LIMIT,
          NEXT_TOKEN,
        ],
        responseExample: `{
  "keys": [
    {
      "keyId": "01JQ8Z6K4M7N9P2R5T8V1W3X6Y",
      "name": "Nightly reporting",
      "prefix": "play_sk_9f2c1a4b",
      "userId": "8f14e45f-ea6c-4f2b-9d3a-1c2b3a4d5e6f",
      "userEmail": "dana@northwind.example",
      "createdAt": 1772582400000,
      "lastUsedAt": 1772668800000,
      "organizationId": "01JQ8Y2A1B3C4D5E6F7G8H9J0K",
      "organizationName": "Northwind Learning"
    }
  ],
  "nextToken": null
}`,
        responseFields: [
          { name: 'keys', type: 'array', description: 'The organization’s keys, newest first.' },
          ...ORGANIZATION_KEY_FIELDS.map((field) => ({ ...field, name: `keys[].${field.name}` })),
        ],
      },
      {
        id: 'revoke-organization-key',
        method: 'DELETE',
        path: '/organizations/{orgId}/api-keys/{keyId}',
        summary: 'Revoke one of the organization’s keys.',
        description:
          'The same hard delete as the one above, performed by an admin on a key somebody else made. The key has to belong to this organization rather than merely exist: an admin of one organization is nobody’s admin in the next.',
        auth: 'session',
        responseStatus: '204 No Content',
        parameters: [
          {
            in: 'path',
            name: 'orgId',
            type: 'string',
            required: true,
            choices: 'organizations',
            description: 'The organization the key was made for.',
            example: '01JQ8Y2A1B3C4D5E6F7G8H9J0K',
          },
          {
            in: 'path',
            name: 'keyId',
            type: 'string',
            required: true,
            choices: 'keys',
            description: 'The key to revoke.',
            example: '01JQ8Z6K4M7N9P2R5T8V1W3X6Y',
          },
        ],
        notes: [
          'A key made for a different organization answers **404**, the same answer an id that does not exist gets.',
        ],
      },
    ],
  },
  {
    id: 'oauth',
    title: 'OAuth: acting as somebody',
    description:
      'The flow a third-party app uses to act as one of our people — with that person’s permission, and only as far as the scopes they agreed to. An app registers first (see the group below), then sends people here.',
    endpoints: [
      {
        id: 'authorize',
        method: 'GET',
        path: '{studio}/oauth/authorize',
        summary: 'Send a person here to sign in and grant permission.',
        description:
          'Not an API call — this is a page in the studio that a *browser* is sent to, which is the one part of the flow an integration does not make itself. The app builds the URL, opens it, and waits for the browser to come back to its redirect URI with a `code`. The page draws the consent screen: what the app is, what it is asking for, and who is signed in.',
        auth: 'browser',
        responseStatus: '302 Found · back to your redirect_uri',
        parameters: [
          { in: 'query', name: 'client_id', type: 'string', required: true, description: 'The app’s client id, from the studio.', example: 'play_app_7c1d9e2f4a6b8c0d' },
          { in: 'query', name: 'redirect_uri', type: 'string', required: true, description: 'Where to send the browser back to. Must match one of the app’s registered URIs **exactly** — no wildcards, no prefix matching. A mismatch is an error page, never a redirect.', example: 'https://example.com/auth/play/callback' },
          { in: 'query', name: 'response_type', type: 'string', required: true, description: 'Always `code`. The implicit flow is not implemented and not coming.', example: 'code' },
          { in: 'query', name: 'scope', type: 'string', description: 'Space-delimited, and optional: leaving it off asks for everything the app is registered for. Asking for a scope the app is not registered for fails the whole request rather than being quietly trimmed.', example: 'profile:read courses:read' },
          { in: 'query', name: 'state', type: 'string', description: 'Opaque, echoed back on the redirect verbatim. Use it: it is what ties the browser that comes back to the request that sent it, and it is the only defence against a login-CSRF that this flow has.', example: 'a1b2c3d4' },
          { in: 'query', name: 'code_challenge', type: 'string', required: true, description: '`base64url(sha256(code_verifier))`, unpadded. Required of **every** client, public or not.', example: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' },
          { in: 'query', name: 'code_challenge_method', type: 'string', required: true, description: 'Always `S256`. `plain` is refused: a challenge sent in the clear proves nothing.', example: 'S256' },
        ],
        notes: [
          'The browser comes back to `redirect_uri?code=…&state=…`, or with `error=access_denied&state=…` if the person pressed Cancel. Both are answers — do not treat a refusal as a hang.',
          'The code is single-use and lives **60 seconds**. Exchange it immediately; do not store it.',
          'If the client id or the redirect URI is wrong, the studio draws an error page and **nothing is redirected anywhere**. That is deliberate: forwarding an error to a URI that has not been verified is how an authorization server becomes an open redirector.',
        ],
      },
      {
        id: 'exchange-code',
        method: 'POST',
        path: '/oauth/token',
        summary: 'Exchange a code for tokens — or a refresh token for a new pair.',
        description:
          'The call an app’s *server* makes. One endpoint, two grant types: `authorization_code` turns the code the browser brought back into an access token and a refresh token, and `refresh_token` turns a refresh token into a new pair when the access token expires. There is no `client_credentials` grant.',
        auth: 'oauth-client',
        bodyEncoding: 'form',
        responseStatus: '200 OK',
        body: [
          { name: 'grant_type', type: 'string', required: true, description: '`authorization_code` or `refresh_token`.', example: 'authorization_code' },
          { name: 'code', type: 'string', description: 'The code from the redirect. Required for `authorization_code`.', example: 'play_ac_9f2c1a4b7d8e0f1a2b3c4d5e' },
          { name: 'code_verifier', type: 'string', description: 'The verifier the challenge was derived from. Required for `authorization_code`, and never sent anywhere before this call.', example: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' },
          { name: 'redirect_uri', type: 'string', description: 'The same URI the code was issued for. Required for `authorization_code`, and required to match.', example: 'https://example.com/auth/play/callback' },
          { name: 'refresh_token', type: 'string', description: 'The refresh token to spend. Required for `refresh_token`.', example: 'play_rt_3a1b9c8d7e6f5a4b3c2d1e0f' },
          { name: 'scope', type: 'string', description: 'On a refresh only, and only to ask for **less** than the grant holds.', example: 'courses:read' },
          { name: 'client_id', type: 'string', required: true, description: 'The app’s client id. May go here, or in an HTTP Basic header with the secret.', example: 'play_app_7c1d9e2f4a6b8c0d' },
          { name: 'client_secret', type: 'string', description: 'Required for a confidential client. Absent for a public one, which authenticates with `client_id` and PKCE alone.', example: 'play_cs_5e4d3c2b1a0f9e8d7c6b5a4d' },
        ],
        responseExample: `{
  "access_token": "play_at_8c7b6a5d4e3f2a1b0c9d8e7f6a5b4c3d",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "play_rt_1f2e3d4c5b6a7988a9b0c1d2e3f4a5b6",
  "scope": "profile:read courses:read"
}`,
        responseFields: [
          { name: 'access_token', type: 'string', description: 'Present this as `Authorization: Bearer …` on every `/v1` call. Lives **one hour**.' },
          { name: 'token_type', type: 'string', description: 'Always `Bearer`.' },
          { name: 'expires_in', type: 'integer', description: 'Seconds until the access token expires. 3600.' },
          { name: 'refresh_token', type: 'string', description: 'Lives **30 days**, and rotates: redeeming it deletes it and issues a new one. Store the new one every time.' },
          { name: 'scope', type: 'string', description: 'What the tokens actually hold — always present, even when it equals what you asked for, so a misconfigured app is visible rather than mysterious.' },
        ],
        notes: [
          'Client authentication is `client_secret_basic` (an `Authorization: Basic` header, with both halves percent-encoded) or `client_secret_post` (the two fields in this body). Both work; libraries differ.',
          'Errors come back in the OAuth shape — `{"error":"invalid_grant","error_description":"…"}` — not in this API’s `{error:{code,message}}` shape, because that is what OAuth client libraries parse.',
          'Every response here is `Cache-Control: no-store`. A token response is a credential.',
          'The old refresh token stops working the moment it is spent. If you lose the response to a refresh, you have lost the connection and the person has to authorize the app again.',
        ],
      },
      {
        id: 'revoke-token',
        method: 'POST',
        path: '/oauth/revoke',
        summary: 'Hand a credential back.',
        description:
          'What an app calls when it is done with somebody — they removed their account from the app, or the app is being shut down. Revoking a **refresh** token takes the access tokens issued with it as well, so "I gave it back" is true immediately rather than in an hour.',
        auth: 'oauth-client',
        bodyEncoding: 'form',
        responseStatus: '200 OK',
        body: [
          { name: 'token', type: 'string', required: true, description: 'The access or refresh token to revoke.', example: 'play_rt_1f2e3d4c5b6a7988a9b0c1d2e3f4a5b6' },
          { name: 'token_type_hint', type: 'string', description: '`access_token` or `refresh_token`. Advisory: this service looks the token up and knows what it is.', example: 'refresh_token' },
          { name: 'client_id', type: 'string', required: true, description: 'The app’s client id.', example: 'play_app_7c1d9e2f4a6b8c0d' },
          { name: 'client_secret', type: 'string', description: 'Required for a confidential client.', example: 'play_cs_5e4d3c2b1a0f9e8d7c6b5a4d' },
        ],
        responseExample: `{}`,
        notes: [
          'The answer is **200 whatever happens** — an unknown token, a token belonging to another app, one already revoked. A 404 would make this endpoint a way to ask "is this string a token".',
          'This is not how a *person* disconnects an app. That is the Connected apps screen, and it ends the authorization itself rather than only its credentials.',
        ],
      },
    ],
  },
  {
    id: 'oauth-apps',
    title: 'Managing OAuth apps',
    description:
      'Registering the client, and reading back what it has been allowed to do. All of these take a signed-in session rather than key — an app is somebody’s, and the studio is where it is managed. The screens that drive them are OAuth apps and Connected apps; this is what they call.',
    endpoints: [
      {
        id: 'list-oauth-apps',
        method: 'GET',
        path: '/oauth/apps',
        summary: 'The apps this account has registered.',
        description:
          'Newest first, and never paged: the number of apps one person may register is capped at the same number they may hold keys — twenty-five — so a list that stopped short would be a list the owner cannot check their own allowance against.',
        auth: 'session',
        responseStatus: '200 OK',
        responseExample: `{
  "apps": [
    {
      "appId": "01JQ9B7M5N8P1Q4R7T0V3W6X9Y",
      "clientId": "play_app_7c1d9e2f4a6b8c0d",
      "name": "Team dashboard",
      "description": "Shows your team's courses and progress in one place.",
      "homepageUrl": "https://example.com",
      "redirectUris": ["https://example.com/auth/play/callback"],
      "scopes": ["profile:read", "courses:read", "lessons:read"],
      "isPublic": false,
      "clientSecretPrefix": "play_cs_5e4d3c2b",
      "createdAt": 1772582400000,
      "updatedAt": 1772582400000
    }
  ]
}`,
        responseFields: [
          { name: 'apps', type: 'array', description: 'The caller’s apps, newest first.' },
          ...OAUTH_APP_FIELDS.map((field) => ({ ...field, name: `apps[].${field.name}` })),
        ],
      },
      {
        id: 'create-oauth-app',
        method: 'POST',
        path: '/oauth/apps',
        summary: 'Register an app, and get its credentials.',
        description:
          'Any signed-in person may register an app. Registering one grants nobody anything: the app acts as the people who authorize it, so what it can reach is decided by a consent screen and a grant, not by who registered it. The response carries the client secret exactly once.',
        auth: 'session',
        responseStatus: '201 Created',
        body: [
          { name: 'name', type: 'string', required: true, description: '2–60 characters. Shown on the consent screen.', example: 'Team dashboard' },
          { name: 'description', type: 'string', required: true, description: 'Up to 280 characters, and required: a consent screen that names an app and explains nothing is not consent.', example: "Shows your team's courses and progress in one place." },
          { name: 'homepageUrl', type: 'string', description: 'Optional, and shown on the consent screen with the app’s name.', example: 'https://example.com' },
          { name: 'logoUrl', type: 'string', description: 'Optional. The app’s mark on the consent screen, and on the connections screen of everybody who authorized it.', example: 'https://example.com/logo.png' },
          { name: 'redirectUris', type: 'array', required: true, description: 'One to ten absolute URIs, matched exactly at authorization time. `https` anywhere, plain `http` only on localhost, or a native app’s own scheme. No fragments.', example: '["https://example.com/auth/play/callback"]' },
          { name: 'scopes', type: 'array', required: true, description: 'The most this app may ever ask a person for. At least one, and a subset of the catalogue below.', example: '["profile:read","courses:read","lessons:read"]' },
          { name: 'isPublic', type: 'boolean', description: 'True for a browser, desktop or CLI app: no secret is minted at all, and the client authenticates with PKCE alone. Defaults to false.', example: 'false' },
        ],
        responseExample: `{
  "app": {
    "appId": "01JQ9B7M5N8P1Q4R7T0V3W6X9Y",
    "clientId": "play_app_7c1d9e2f4a6b8c0d",
    "name": "Team dashboard",
    "description": "Shows your team's courses and progress in one place.",
    "redirectUris": ["https://example.com/auth/play/callback"],
    "scopes": ["profile:read", "courses:read", "lessons:read"],
    "isPublic": false,
    "clientSecretPrefix": "play_cs_5e4d3c2b",
    "createdAt": 1772582400000,
    "updatedAt": 1772582400000
  },
  "secret": "play_cs_5e4d3c2b1a0f9e8d7c6b5a4d3e2f1a0b"
}`,
        responseFields: [
          { name: 'app', type: 'object', description: 'The app as its owner sees it.' },
          ...OAUTH_APP_FIELDS.map((field) => ({ ...field, name: `app.${field.name}` })),
          { name: 'secret', type: 'string?', description: 'The client secret, and the only time it is ever transmitted. Absent on a public client.' },
        ],
        notes: [
          'The secret is stored as a SHA-256 hash. Nothing — not support, not an admin — can read one back, so "copy it now" is the shape of that dialog rather than a nicety.',
          'Registering a **public** client is the right answer for anything that ships to a machine somebody else controls. A secret inside a browser bundle is not a secret, and a screen that handed one over would teach its author that their app is authenticated when anything holding the string is.',
        ],
      },
      {
        id: 'get-oauth-app',
        method: 'GET',
        path: '/oauth/apps/{appId}',
        summary: 'One app, in full.',
        description:
          'The app’s own settings page: every redirect URI, every scope it is registered for, its client id, and the prefix of its secret.',
        auth: 'session',
        responseStatus: '200 OK',
        parameters: [
          { in: 'path', name: 'appId', type: 'string', required: true, description: 'The app’s ULID — not its client id. The two are different strings, and this path wants the shorter one.', example: '01JQ9B7M5N8P1Q4R7T0V3W6X9Y' },
        ],
        responseExample: `{
  "app": {
    "appId": "01JQ9B7M5N8P1Q4R7T0V3W6X9Y",
    "clientId": "play_app_7c1d9e2f4a6b8c0d",
    "name": "Team dashboard",
    "description": "Shows your team's courses and progress in one place.",
    "redirectUris": ["https://example.com/auth/play/callback"],
    "scopes": ["profile:read", "courses:read", "lessons:read"],
    "isPublic": false,
    "clientSecretPrefix": "play_cs_5e4d3c2b",
    "createdAt": 1772582400000,
    "updatedAt": 1772582400000
  }
}`,
        notes: ['Somebody else’s app answers **404**, the same answer an id that does not exist gets.'],
      },
      {
        id: 'update-oauth-app',
        method: 'PATCH',
        path: '/oauth/apps/{appId}',
        summary: 'Edit an app.',
        description:
          'Only the fields sent are written, and `null` clears an optional one. Changing what the app is *called* or where it is sent back to touches nobody’s connection; changing the **scopes** ends every authorization of the app, because a person agreed to a list printed on a screen and a changed list has to be agreed to again.',
        auth: 'session',
        responseStatus: '200 OK',
        parameters: [
          { in: 'path', name: 'appId', type: 'string', required: true, description: 'The app’s ULID.', example: '01JQ9B7M5N8P1Q4R7T0V3W6X9Y' },
        ],
        body: [
          { name: 'name', type: 'string', description: 'A new name.', example: 'Team dashboard' },
          { name: 'description', type: 'string', description: 'A new sentence for the consent screen.', example: 'Courses, progress and certificates in one place.' },
          { name: 'homepageUrl', type: 'string?', description: '`null` clears it; absent leaves it alone.', example: 'https://example.com' },
          { name: 'logoUrl', type: 'string?', description: '`null` clears it; absent leaves it alone.', example: 'https://example.com/logo.png' },
          { name: 'redirectUris', type: 'array', description: 'The whole list, not a change to it. Removing one breaks that flow and disconnects nobody.', example: '["https://example.com/auth/play/callback"]' },
          { name: 'scopes', type: 'array', description: 'The whole list. Changing it disconnects everybody who has connected the app.', example: '["profile:read","courses:read"]' },
        ],
        responseExample: `{
  "app": {
    "appId": "01JQ9B7M5N8P1Q4R7T0V3W6X9Y",
    "clientId": "play_app_7c1d9e2f4a6b8c0d",
    "name": "Team dashboard",
    "description": "Courses, progress and certificates in one place.",
    "redirectUris": ["https://example.com/auth/play/callback"],
    "scopes": ["profile:read", "courses:read"],
    "isPublic": false,
    "clientSecretPrefix": "play_cs_5e4d3c2b",
    "createdAt": 1772582400000,
    "updatedAt": 1772680000000
  },
  "authorizationsEnded": 3
}`,
        responseFields: [
          { name: 'app', type: 'object', description: 'The app as it now stands.' },
          { name: 'authorizationsEnded', type: 'integer?', description: 'How many people were disconnected by a scope change. Present only when the scopes changed.' },
        ],
        notes: [
          'Whether a client can keep a secret is **not** editable. It is a fact about where the code runs, decided when the app is registered: flipping it later would either invent a secret into a running browser app or take one away from a deployed server.',
        ],
      },
      {
        id: 'rotate-oauth-app-secret',
        method: 'POST',
        path: '/oauth/apps/{appId}/secret',
        summary: 'Replace an app’s client secret.',
        description:
          'Rotation rather than addition: an app has one secret, and an app that thinks its secret leaked wants the old one to stop working. The previous secret is refused the moment this returns, so the app has to be redeployed with the new value to keep authenticating.',
        auth: 'session',
        responseStatus: '200 OK',
        parameters: [
          { in: 'path', name: 'appId', type: 'string', required: true, description: 'The app’s ULID.', example: '01JQ9B7M5N8P1Q4R7T0V3W6X9Y' },
        ],
        responseExample: `{
  "app": { "appId": "01JQ9B7M5N8P1Q4R7T0V3W6X9Y", "clientSecretPrefix": "play_cs_9a8b7c6d" },
  "secret": "play_cs_9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d"
}`,
        responseFields: [
          { name: 'app', type: 'object', description: 'The app, with its new secret prefix.' },
          { name: 'secret', type: 'string', description: 'The new secret, shown once.' },
        ],
        notes: [
          'A **public** client answers **400**: it has no secret to rotate, and it is told so rather than being handed one.',
          'People who have connected the app are unaffected. A client secret is what the app authenticates *itself* with; their grants and tokens are theirs.',
        ],
      },
      {
        id: 'delete-oauth-app',
        method: 'DELETE',
        path: '/oauth/apps/{appId}',
        summary: 'Delete an app, and end everything it was given.',
        description:
          'A hard delete that goes further than the row: every authorization of the app is ended and every token those produced is deleted first, so nothing the client was given still works. An app deleted before its tokens would leave credentials behind that authenticate calls, point at no client, and appear on somebody’s connections screen under a name that no longer exists.',
        auth: 'session',
        responseStatus: '204 No Content',
        parameters: [
          { in: 'path', name: 'appId', type: 'string', required: true, description: 'The app’s ULID.', example: '01JQ9B7M5N8P1Q4R7T0V3W6X9Y' },
        ],
        notes: ['Everybody who connected the app is disconnected, and the app is not told: its next call is refused, which is how it finds out.'],
      },
      {
        id: 'list-connections',
        method: 'GET',
        path: '/oauth/connections',
        summary: 'What this account has let in.',
        description:
          'Every app this person has authorized, what each one was allowed, when they connected it and when it last did anything. The apps are read live rather than denormalized onto the grant: an app can rename itself at any moment, and somebody deciding whether to keep a connection needs to see what the app *is* rather than what it was called on the day they authorized it.',
        auth: 'session',
        responseStatus: '200 OK',
        responseExample: `{
  "connections": [
    {
      "appId": "01JQ9B7M5N8P1Q4R7T0V3W6X9Y",
      "clientId": "play_app_7c1d9e2f4a6b8c0d",
      "name": "Team dashboard",
      "description": "Shows your team's courses and progress in one place.",
      "scopes": ["profile:read", "courses:read"],
      "createdAt": 1772582400000,
      "updatedAt": 1772582400000,
      "lastUsedAt": 1772668800000
    }
  ]
}`,
        responseFields: [
          { name: 'connections', type: 'array', description: 'The apps this person has authorized, most recently agreed to first.' },
          { name: 'connections[].scopes', type: 'array', description: 'What this person agreed to — which may be less than the app is registered for, if its registration narrowed after they consented.' },
          { name: 'connections[].lastUsedAt', type: 'number?', description: 'When the app last used the grant, accurate to about five minutes. Absent until it has.' },
        ],
      },
      {
        id: 'delete-connection',
        method: 'DELETE',
        path: '/oauth/connections/{appId}',
        summary: 'Disconnect an app from this account.',
        description:
          'The person’s own revoke, and the one that has to work while nobody is looking: it deletes the grant and every token the app holds for this account, so the app stops being able to call this API on its next request rather than within the hour its access token would have expired. Nothing is cached in front of the authorizer, which is what makes that true.',
        auth: 'session',
        responseStatus: '204 No Content',
        parameters: [
          { in: 'path', name: 'appId', type: 'string', required: true, description: 'The app to disconnect — its ULID.', example: '01JQ9B7M5N8P1Q4R7T0V3W6X9Y' },
        ],
        notes: [
          'The app is not told, and there is no webhook: an app finds out by being refused, which is how it finds out that an access token expired too. A callback would mean this service making an outbound request to a URL a client chose.',
          'An app this person has not authorized answers **404**, the same answer an unknown app id gets.',
        ],
      },
    ],
  },
];

/** How a call is authenticated, said in one line for the badge on each endpoint. */
export const API_AUTH_LABELS: Record<ApiEndpoint['auth'], string> = {
  key: 'API key or bearer token',
  session: 'Signed-in session',
  'oauth-client': 'client_id + client_secret',
  browser: 'A person’s browser',
};

/**
 * The scope catalogue, as the reference reads it.
 *
 * Two sentences per scope because a consent screen has two jobs here: the
 * heading is what it says to the person agreeing, and `reach` is what it says to
 * the developer building against it. They are different sentences — "See your
 * profile" and "`GET /v1/me/profile`" are not paraphrases of each other — and a
 * reference that printed only one of them would be wrong for one of its two
 * readers.
 */
export interface ApiScopeDoc {
  scope: ApiScope;
  /** What the consent screen says. */
  title: string;
  /** What it opens, said to whoever is writing the client. */
  reach: string;
}

export const OAUTH_SCOPE_DOCS: ApiScopeDoc[] = [
  {
    scope: 'profile:read',
    title: 'See your profile',
    reach: '`GET /v1/me/profile`: a name, a photo, a sentence and links. An API key never holds this one.',
  },
  {
    scope: 'courses:read',
    title: 'Read the published catalog',
    reach: '`GET /v1/courses` and `GET /v1/courses/{spaceId}` — the courses their authors have listed.',
  },
  {
    scope: 'lessons:read',
    title: 'Read course outlines and lessons',
    reach: 'The outline, one lesson, and a lesson’s attachments — including courses that are not published, when the person authorizing may read them.',
  },
  {
    scope: 'lessons:stream',
    title: 'Play lesson videos',
    reach: '`GET /v1/lessons/{contentId}/stream` and `/subtitles`: signed media URLs. Its own scope because serving video is what costs money.',
  },
  {
    scope: 'organization:courses:read',
    title: 'Read the courses of an organization',
    reach: '`GET /v1/organizations/{orgId}/courses`, published or not. The only scope that reaches anything unpublished, and the person authorizing must be a member of that organization.',
  },
];

/**
 * The errors every endpoint can answer with, in one place rather than repeated
 * on each one: the reference has one error section and each endpoint adds only
 * what is peculiar to it.
 */
export const API_ERRORS: { status: string; meaning: string }[] = [
  {
    status: '400',
    meaning: 'A query parameter or a request body the API could not accept — a `query` longer than 80 characters, a non-numeric limit, malformed JSON.',
  },
  {
    status: '401',
    meaning:
      'No credential, or one that does not authenticate: an unknown or revoked key, an expired or spent access token, a malformed one. A `/v1` route answers this itself — the credential is read from whichever header carries it — so the body is this API’s own shape rather than the gateway’s. A method that takes a *session* — everything that mints or revokes a credential — answers 401 the same way when called without one.',
  },
  {
    status: '403',
    meaning:
      'A credential that is valid and is not allowed *this*: **missing a scope** the route needs (`This credential is missing the lessons:stream scope`), a key not made for the organization being asked about, or a caller who is not one of that organization’s admins. The scope refusal names the scope on purpose: a scope is not a secret, and an integration that has run out of permission needs to know which permission to ask its user for.',
  },
  {
    status: '404',
    meaning: 'No such course, or a course that exists but has not been published. No such key — which includes one belonging to somebody else, and one already revoked, because revocation deletes it.',
  },
  { status: '409', meaning: 'The account already holds the maximum number of keys.' },
  { status: '500', meaning: 'Something failed on our side. The request can be retried.' },
];

/** The shape of every error this API produces itself. */
export const API_ERROR_EXAMPLE = `{
  "error": {
    "code": 403,
    "message": "This API key was not made for that organization"
  }
}`;
