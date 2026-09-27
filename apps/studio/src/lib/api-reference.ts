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

export interface ApiField {
  name: string;
  type: string;
  required?: boolean;
  description: string;
  /** The value used in the generated examples. */
  example?: string;
}

export interface ApiParameter extends ApiField {
  in: 'path' | 'query';
}

export interface ApiEndpoint {
  /** The anchor it is linked by, and what the rail scrolls to. */
  id: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  summary: string;
  /** One or two sentences on what it is for and anything surprising about it. */
  description: string;
  /**
   * What authenticates the call: an API key, or a signed-in session. They are
   * different credentials and the difference matters to whoever is reading.
   */
  auth: 'key' | 'session';
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

export const API_ENDPOINT_GROUPS: ApiEndpointGroup[] = [
  {
    id: 'account',
    title: 'The key itself',
    description:
      'What the key you are holding is. Behind an API key, like everything under /v1.',
    endpoints: [
      {
        id: 'get-me',
        method: 'GET',
        path: '/v1/me',
        summary: 'Check a key, and see what it reaches.',
        description:
          'The first call to make with a new key, and the one that answers both questions a key’s owner has: does this work, and what does it unlock. It reads the key’s own record, so the organization it names is the organization that will answer the endpoint below.',
        auth: 'key',
        responseStatus: '200 OK',
        responseExample: `{
  "key": {
    "keyId": "01JQ8Z6K4M7N9P2R5T8V1W3X6Y",
    "name": "Nightly reporting",
    "prefix": "play_sk_9f2c1a4b",
    "createdAt": 1772582400000,
    "lastUsedAt": 1772668800000,
    "organizationId": "01JQ8Y2A1B3C4D5E6F7G8H9J0K",
    "organizationName": "Northwind Learning"
  },
  "owner": {
    "userId": "8f14e45f-ea6c-4f2b-9d3a-1c2b3a4d5e6f"
  }
}`,
        responseFields: [
          ...KEY_FIELDS,
          { name: 'owner.userId', type: 'string', description: 'Cognito `sub` of the person the key acts as. Every read is attributed to them.' },
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
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'spaceId',
            type: 'string',
            required: true,
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
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'orgId',
            type: 'string',
            required: true,
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
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'spaceId',
            type: 'string',
            required: true,
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
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'contentId',
            type: 'string',
            required: true,
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
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'contentId',
            type: 'string',
            required: true,
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
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'contentId',
            type: 'string',
            required: true,
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
        responseStatus: '200 OK',
        parameters: [
          {
            in: 'path',
            name: 'contentId',
            type: 'string',
            required: true,
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
            description: 'The organization the key was made for.',
            example: '01JQ8Y2A1B3C4D5E6F7G8H9J0K',
          },
          {
            in: 'path',
            name: 'keyId',
            type: 'string',
            required: true,
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
];

/** How a call is authenticated, said in one line for the badge on each endpoint. */
export const API_AUTH_LABELS: Record<ApiEndpoint['auth'], string> = {
  key: 'x-api-key header',
  session: 'Signed-in session',
};

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
      'No key was sent at all. API Gateway refuses a request with no `x-api-key` header before the endpoint runs, so the body is the gateway’s own `{"message":"Unauthorized"}` rather than the error shape below.',
  },
  {
    status: '403',
    meaning:
      'Either the key was rejected — it is unknown or has been revoked — or it is valid but was not made for the organization being asked about, or the caller is not one of that organization’s admins. The first of those is answered by API Gateway before the endpoint runs, so its body is the gateway’s own `{"message":"User is not authorized to access this resource…"}` rather than the shape below; the others are ours.',
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
