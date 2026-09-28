# Play Demo — Fieldnotes

A third-party app, in this repository, that signs people in with Play and then
reads the public API with the token it was given.

It exists to answer two questions that are otherwise hard to answer by reading
code:

- **What is OAuth like from the other side?** This app registers as a client,
  sends somebody to Play's consent screen, spends the code with PKCE, renews from
  a rotating refresh token and revokes on the way out. Every request it makes is
  one of four endpoints, written out by hand rather than hidden behind a library.
- **What can somebody build on `/v1`?** A classroom: an outline, a lesson, the
  video, the transcript that follows along word by word, and the files beside it
  — using the *same* player and transcript components Play's own apps use, driven
  entirely by the public API.

What it deliberately is not: Play. There is no `@play/auth` and no `@play/api` in
this app's tree — no sign-in, no Cognito, no session. It holds an OAuth token and
nothing else.

```bash
npm run dev:demo        # http://localhost:4000
```

## Setup, once

A client id cannot be derived — it is minted when somebody registers an app — so
there is one step before this app can sign anybody in. With nothing configured it
renders those instructions itself, with copy buttons; this is the same thing in
prose.

1. **Register the app.** In the studio, under **OAuth apps** → *Register app*
   (<http://localhost:3000/oauth/apps>):

   | Field | Value |
   | --- | --- |
   | Name | `Fieldnotes` |
   | What does it do? | anything one sentence long — it is what the consent screen shows |
   | Redirect URI | `http://localhost:4000/auth/callback` |
   | Scopes | `profile:read`, `courses:read`, `lessons:read`, `lessons:stream` |
   | Public client? | **yes** |

   Two of those are easy to get wrong, so they are worth repeating. The redirect
   URI is matched **exactly** — port and path, no wildcards — because it is where
   Play sends a code that acts as somebody. And the app has to be *registered* for
   `lessons:stream`: a new app starts with three scopes, asking for a fourth it is
   not registered for fails the whole authorization request, and the demo plays
   video, so it asks.

2. **Public client, not confidential.** This app runs in a browser, so it has no
   client secret and does not want one: PKCE is what stands in for it, and a
   secret shipped inside a browser bundle is not a secret. Registering it as a
   public client is the honest way to ask for it.

3. **Give the app the client id.**

   ```bash
   # apps/demo/.env.local
   NEXT_PUBLIC_API_URL=https://<your-api-id>.execute-api.<region>.amazonaws.com/dev
   NEXT_PUBLIC_PLAY_STUDIO_URL=http://localhost:3000
   NEXT_PUBLIC_PLAY_CLIENT_ID=play_app_…
   ```

   `NEXT_PUBLIC_API_URL` is the same value the studio and the marketplace use, and
   `npm run get-env` writes it — the script preserves keys it does not manage, so
   the client id survives it. Then restart the dev server.

That is the whole setup. There is no secret to rotate, no server to deploy and
nothing to keep in step with Play beyond the redirect URI.

### If you registered it as a confidential client

The form defaults to a confidential client, and the studio shows a secret to copy,
so this is an easy thing to do by accident. It also cannot be undone: whether a
client can keep a secret is decided when it is registered, because the alternative
is an app that changes shape underneath the people it has already asked.

The app still runs — put the secret in `NEXT_PUBLIC_PLAY_CLIENT_SECRET` and it
will send it the way a confidential client does — but it will tell you, on the
front page, that a browser app holding a secret is holding nothing. That warning
is the useful half of the demo: the mistake is invisible on the consent screen and
invisible in the network tab, and a secret that does no work is worse than no
secret, because it teaches that authentication is happening when it is not.

The right fix is a **new app** registered as a public client, with the same
redirect URI and scopes and the box ticked.

## What to look at

| Route | What it demonstrates |
| --- | --- |
| `/` | The flow end to end, the scopes asked for, and the identity Play returns — including the profile, which is the one permission that is about a person rather than a catalog |
| `/auth/callback` | The second leg: reading `code` and `state`, checking the state, and spending the code with the verifier that never left the tab |
| `/courses` | `GET /v1/courses` — and the fact that the answer depends on *who* authorized the app |
| `/courses/{spaceId}` | The classroom. Published courses come from the catalog; a course nobody has listed still opens, through the route authorized by access rather than by publication |

Every page ends with the list of endpoints it called, so the screen stops being
magic and becomes five documented requests.

## What it does not do, on purpose

- **Nothing is written.** The public API is read-only; there is no
  "mark complete", no comment, no enrolment. A demo that appeared to write would
  be demonstrating an API that does not exist.
- **Nothing beyond what the person can read.** The token acts as them, so asking
  for somebody else's unpublished course is a 403 whether it is asked for here or
  anywhere else.
- **No progress, favourites or loops.** Those are endpoints behind a signed-in
  session in Play's own apps, not part of `/v1` — the line the public API draws,
  visible as the tabs the shared classroom has here and the ones it does not.

## How it is put together

```
src/lib/oauth/     config, PKCE, the four calls, and the token store
src/lib/api/v1.ts  every endpoint this app uses, one function each
src/components/    the classroom: outline, lesson panel, and Play's own player
```

The two things worth reading are `src/lib/oauth/client.ts` — four functions, each
one an endpoint from the API reference — and `src/components/classroom/lesson-panel.tsx`,
which draws the transcript with the same `AnimatedTranscript` the studio uses,
from data fetched with a bearer token.
