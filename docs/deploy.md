# Deploying the two apps to Vercel

Play Studio and Play Marketplace are two Vercel projects built from this one
repository. The backend is not part of this: `services/api` is the Serverless
stack on AWS, and it stays there — Vercel serves the two Next apps, and both of
them call the same deployed API and the same Cognito user pool.

Read [workspace.md](workspace.md) first if the layout is new. Two facts from it
shape everything below:

- **One install, two builds.** The repository is an npm workspace, so Vercel
  installs once at the repo root and both projects build from that install. Each
  project differs from the other only in its Root Directory.
- **The packages are source, not builds.** `@play/*` ships `.ts`/`.tsx` with no
  `dist/`, and each app compiles them through `transpilePackages` +
  `experimental.externalDir`. Everything Vercel needs is therefore already in the
  repository — but the app it builds lives in `apps/<app>` while the code it
  imports lives in `packages/`, so the build has to be allowed to read outside
  its own directory.

No `vercel.json` is needed. Default detection handles npm workspaces and Next.js;
the two settings that matter are in the dashboard and are called out below.

## Before you start

| Needed | Why |
| --- | --- |
| The repo pushed to GitHub (`origin`) | Vercel builds from the remote, not from your machine |
| A Vercel account with access to that repo | Two projects, both importing it |
| A deployed backend — `play-backend-dev` exists | The apps are useless without an API URL and a user pool |
| `npm run build` passing locally | It does; both apps compile clean, which is the whole build Vercel runs |

The values Vercel needs are the ones already in each app's `.env.local`, written
by `npm run get-env`:

```bash
grep -h . apps/studio/.env.local apps/marketplace/.env.local
```

## The environment variables

Both projects get the same five values, because both apps talk to the same
backend. The studio gets one more.

| Variable | Where the value comes from | Studio | Marketplace |
| --- | --- | :---: | :---: |
| `NEXT_PUBLIC_API_URL` | stack output `ApiUrl` | ✓ | ✓ |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | stack output `CognitoUserPoolId` | ✓ | ✓ |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | stack output `CognitoUserPoolClientId` | ✓ | ✓ |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | stack output `CognitoDomain` | ✓ | ✓ |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | stack output `GoogleAuthEnabled` | ✓ | ✓ |
| `NEXT_PUBLIC_MARKETPLACE_URL` | the marketplace's domain, `https://lets-play.xyz` | ✓ | — |

The last two are the optional pair: they exist only when the backend was
deployed with Google OAuth credentials (`services/api/scripts/set-google-oauth.sh`).
A stack without them writes neither, and both apps then offer email and password
only — so copy what `get-env` actually wrote rather than all six by hand.

Two things worth knowing about that list:

- **`NEXT_PUBLIC_*` is inlined at build time.** Next substitutes these while
  compiling, so changing one does nothing until the project is redeployed.
  Setting a new value and refreshing the page is not a fix for anything.
- **The redirect URLs are deliberately not in it.** `@play/auth` builds them from
  `window.location.origin`, which is how one package serves two apps on different
  ports. A deployed origin is registered on the user pool instead — that is the
  next section, and it is the step that is easy to skip.

None of these are secrets in the sense of being hidden — every one of them is in
the JavaScript bundle any visitor downloads — but they are not tracked in git
either. Vercel is where they live instead of `.env.local`.

## Project 1 — Play Studio

In the Vercel dashboard: **Add New → Project → Import** the `play` repository.
Before pressing Deploy:

| Setting | Value |
| --- | --- |
| Project Name | `play-studio` (whatever you like; it becomes the `*.vercel.app` domain) |
| Framework Preset | Next.js — detected |
| **Root Directory** | `apps/studio` |
| Build Command | default (`next build`) |
| Output Directory | default (`.next`) |
| Install Command | default (`npm install`, run at the repo root) |

Then, under the Root Directory field, **make sure "Include source files outside
of the Root Directory in the Build Step" is enabled.** Vercel turns this on
itself for a detected workspace, and it is the setting that lets `apps/studio`
resolve `@play/ui` from `packages/ui`. With it off, the build fails on the first
`@play/*` import — which reads as a broken import rather than a project setting.

Add the five backend variables above — for Production, Preview and Development
alike, since a preview that cannot reach the API is not a preview of anything —
then Deploy. The studio's sixth variable points at a project that does not exist
yet; it comes at the end of the next section.

## Project 2 — Play Marketplace

**Add New → Project**, import the *same* repository a second time, and set the
**Root Directory** to `apps/marketplace`. Same framework preset, same defaults,
same "include files outside the Root Directory" check, same five backend
variables — but not `NEXT_PUBLIC_MARKETPLACE_URL`, because the marketplace is
where that URL points.

The marketplace does not need to know where the studio is: nothing in it links
back. The link is one-way, which is why only the studio carries the variable.

Once both projects exist, set `NEXT_PUBLIC_MARKETPLACE_URL` on the **studio**
project to the marketplace's domain and redeploy it. Without it the studio's
course-publish card says this deployment has no marketplace rather than linking
nowhere — a graceful default, but not what you want in production.

## Register the deployed origins with Cognito

This is the part that fails last and looks like a bug in the app. Signing in with
Google sends the browser to Cognito, and Cognito only returns it to a URL that is
on a list held by the app client — anything else is refused with
`redirect_mismatch`. Email and password sign-in never leaves the page, so it
works on a domain nobody has registered; Google is the one that needs this. That
asymmetry is worth knowing before you debug the wrong half of it.

The list is a deploy-time value: it lives in SSM, it has no stage in its name —
`/play/auth/callback-urls`, so one list serves every stage — and it is read into
the app client when the backend is deployed. A value in SSM wins over the
defaults in `serverless.yml`.

`set-auth-urls.sh`'s own defaults are already the list this deployment wants:
both apps on localhost, and both on their domains (studio.lets-play.xyz and
lets-play.xyz). So the write is the script with no arguments, and the only reason
to pass `--callback-urls` is to say something different:

```bash
# the four origins, each as a /auth/callback path and a bare origin: the path is
# where a sign-in returns to, the bare origin is where a sign-out does
services/api/scripts/set-auth-urls.sh --stage=dev --profile=yoserverless

# Cognito only re-reads the list at deploy time, so the pool still holds the old
# one until you do this
npm run deploy --workspace play-backend -- --stage dev --aws-profile yoserverless

# what the pool actually accepts now
aws cognito-idp describe-user-pool-client \
  --user-pool-id us-east-1_D7mJYJiqy --client-id 1j0lniedu2vmlelautok8bhurb \
  --profile yoserverless --region us-east-1 \
  --query 'UserPoolClient.CallbackURLs'
```

Keep localhost in the list. It costs nothing, and dropping it means the next
local sign-in stops working — and keep the *bare* origin as well as the
`/auth/callback` path: the bare origin is the post-sign-out destination.

One list serves every domain because Amplify chooses from it by hostname: on
`https://studio.lets-play.xyz/sign-in` it picks the entry containing
`studio.lets-play.xyz`, and on localhost it picks the `localhost:3000` one. That is
the whole mechanism behind "one package, two apps, two domains" — and it is also
why an origin that is missing from the list cannot sign in with Google at all.

### Emails point at the apps too

Invitations and reward notifications are mailed by the backend, and their links
come from two more SSM parameters rather than from anything Vercel knows:

```bash
aws ssm put-parameter --name /play/mail/app-base-url --type String \
  --value "https://studio.lets-play.xyz" --overwrite --profile yoserverless --region us-east-1
aws ssm put-parameter --name /play/mail/marketplace-base-url --type String \
  --value "https://lets-play.xyz" --overwrite --profile yoserverless --region us-east-1

npm run deploy --workspace play-backend -- --stage dev --aws-profile yoserverless
```

Leave them unset and an invitation to a real person points at
`http://localhost:3000`, which is a link that only works on your laptop.

## Custom domains

Add the domains in each project's **Settings → Domains** — `studio.lets-play.xyz`
on the studio project, `lets-play.xyz` on the marketplace — and follow Vercel's
DNS instructions (an `A`/`CNAME` record, or nameservers if you are handing it the
whole zone). Do the Cognito registration *after* the domain resolves, so the list
you register matches what is actually serving.

The order matters for one reason: Cognito compares the origin the browser is on.
A domain that is added in Vercel but not registered on the pool gives you Google
sign-in that fails on the custom domain and works on the `*.vercel.app` one —
confusing in exactly the wrong direction.

## Preview deployments

Every deployment gets its own URL, and every one of them is an origin Cognito has
never seen. What happens there depends on how somebody signs in:

- **Email and password works on any URL.** It is a direct API call, with no
  redirect for anyone to check.
- **Google does not.** Before leaving the page, Amplify picks the redirect URL
  out of `NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN` whose *hostname* matches the one
  in the address bar, and refuses to start the round trip when none does — on a
  preview URL `play-studio-git-my-branch-…vercel.app`, the registered
  `play-studio.vercel.app` is not a match. Setting that variable to a fixed
  production URL in the Preview environment does not help: the check is against
  the page's own host, so a preview origin can only sign in with Google if that
  preview host is itself in the list.

That gives three real options, in order of how much work they are: test Google on
production or on a custom domain, register the branch's own hostname in the
Cognito list (preview URLs are deterministically named, so a long-lived branch
alias is a URL you can register once), or use email and password on previews.

## After the first deploy

Work through this once; each line is a different wiring mistake:

1. `https://studio.lets-play.xyz` loads and does not bounce to sign-in in a loop.
2. Sign in with **email and password** on both apps (same account, one pool).
3. **Sign in with Google** on both, and land back on the right app — this is the
   redirect-list check.
4. Publish a course in the studio, and see it in the marketplace catalog.
5. Invite somebody, and confirm the email's link points at the deployed studio.
6. Open a lesson in the marketplace and play a video.

## Notes

- **This build has been rehearsed.** A clone of the repository with no
  `.env.local` in it (they are gitignored, so Vercel will not have them either),
  `npm ci` against `package-lock.json`, and `npm run build` with the variables
  above in the environment builds both apps — studio 20 routes, marketplace 9.
- **Node.** The repo asks for `>= 20`; Vercel's default runtime satisfies it, so
  there is nothing to pin.
- **Install time.** A root `npm install` also installs `services/api`'s
  devDependencies, `serverless` included, for builds that never use them. It is
  waste, not a problem, and the Vercel install cache hides most of it. If it
  starts to hurt, scope the Install Command to the app being built (for example
  `npm install --workspace=play-studio --include-workspace-root`) and verify it
  in a preview deployment first — the default is the path that has been tested.
- **The backend deploys from your machine, not from Vercel.** `npm run deploy`
  still happens here, against AWS credentials Vercel never sees. Vercel only ever
  builds the two frontends.
