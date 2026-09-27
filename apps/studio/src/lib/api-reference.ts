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
  /** The JSON the endpoint answers with, exactly as it arrives. */
  responseExample: string;
  responseFields: ApiField[];
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
  { name: 'revokedAt', type: 'number?', description: 'Set once the key is revoked. A revoked key stays in the list and stops authenticating.' },
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
    id: 'keys',
    title: 'Managing keys',
    description:
      'The same operations the studio performs when you press Create key or Revoke. These take your **signed-in session**, not an API key: a key cannot mint keys.',
    endpoints: [
      {
        id: 'list-keys',
        method: 'GET',
        path: '/me/api-keys',
        summary: 'Your own keys.',
        description:
          'Every key you have made, newest first, revoked ones included — a revoked key is kept because “did I already cut that one off?” is a question, and a list that dropped the row would answer it with nothing.',
        auth: 'session',
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
          'One account may hold 25 unrevoked keys at a time. Past that, creating one answers **409** and asks you to revoke one first — an unbounded list of keys is an unbounded list of things that can be lost.',
        ],
      },
      {
        id: 'revoke-key',
        method: 'DELETE',
        path: '/me/api-keys/{keyId}',
        summary: 'Revoke one of your own keys.',
        description:
          'The key stops authenticating on the next request — nothing is cached in front of the authorizer, so there is no window in which a revoked key still works. The row is kept and comes back marked revoked: the secret is unrecoverable, so the record of *when* it was cut off is the only thing that survives.',
        auth: 'session',
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
        responseExample: `{
  "key": {
    "keyId": "01JQ8Z6K4M7N9P2R5T8V1W3X6Y",
    "name": "Nightly reporting",
    "prefix": "play_sk_9f2c1a4b",
    "createdAt": 1772582400000,
    "revokedAt": 1772755200000
  }
}`,
        responseFields: [
          { name: 'key', type: 'object', description: 'The key as it now stands, with `revokedAt` set.' },
        ],
        notes: [
          'Revoking a key twice is not an error: the second call returns the same row with the original `revokedAt`, because the timestamp is the moment it happened rather than the moment somebody looked again.',
          'Someone else’s key answers **404**, not 403. Which key ids exist is not a stranger’s business.',
        ],
      },
      {
        id: 'list-organization-keys',
        method: 'GET',
        path: '/organizations/{orgId}/api-keys',
        summary: 'Every key made for an organization, whoever made it.',
        description:
          'An admin’s list. Keys outlive the integrations they were made for and often the people who made them, so the question “who still has access to this?” has to be answerable by somebody other than the person holding the key.',
        auth: 'session',
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
          'The same revocation as the one above, performed by an admin on a key somebody else made. The key has to belong to this organization rather than merely exist: an admin of one organization is nobody’s admin in the next.',
        auth: 'session',
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
        responseExample: `{
  "key": {
    "keyId": "01JQ8Z6K4M7N9P2R5T8V1W3X6Y",
    "name": "Nightly reporting",
    "prefix": "play_sk_9f2c1a4b",
    "userId": "8f14e45f-ea6c-4f2b-9d3a-1c2b3a4d5e6f",
    "userEmail": "dana@northwind.example",
    "createdAt": 1772582400000,
    "revokedAt": 1772755200000
  }
}`,
        responseFields: [
          { name: 'key', type: 'object', description: 'The key as it now stands, with `revokedAt` set.' },
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
      'The key was rejected — it is unknown or has been revoked — or it is valid but was not made for the organization being asked about, or the caller is not one of that organization’s admins.',
  },
  {
    status: '404',
    meaning: 'No such course, or a course that exists but has not been published. No such key, or one belonging to somebody else.',
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
