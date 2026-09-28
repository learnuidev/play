import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRightIcon,
  BracesIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  SquareCodeIcon,
  ZapIcon,
} from 'lucide-react';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { CopyButton } from '@/components/copy-button';
import { CodeBlock } from '@/components/docs/code-block';
import { CredentialPanel } from '@/components/docs/credential-panel';
import { DocsRail } from '@/components/docs/docs-rail';
import { EndpointCard } from '@/components/docs/endpoint-card';
import { renderEmphasis } from '@/components/docs/emphasis';
import { PlaygroundProvider } from '@/components/docs/playground-context';
import { PublicHeader } from '@/components/public-header';
import { API_BASE_URL, API_BASE_URL_IS_CONFIGURED } from '@/lib/api-base';
import { curlFor } from '@/lib/api-example';
import {
  API_ENDPOINT_GROUPS,
  API_ERRORS,
  API_ERROR_EXAMPLE,
  OAUTH_SCOPE_DOCS,
} from '@/lib/api-reference';

/**
 * The API reference.
 *
 * One page rather than a page per endpoint, on purpose: this API is small enough
 * to read end to end, and a reader who can scroll from "what a key is" to "the
 * exact JSON that comes back" learns the whole surface in one sitting. When it
 * stops fitting, it splits — the data behind it (`lib/api-reference`) is already
 * one object per endpoint and does not care how many pages render it.
 *
 * The layout is the reference's own: a rail of anchors and a column of cards,
 * rather than the app's sidebar. A reference is not a place you navigate around
 * — you arrive from a key you just made, read the section you came for, and go
 * back to your terminal.
 *
 * It is public, and it is read by two kinds of people because of it: somebody who
 * already has a credential, arriving from the keys or the apps screen, and
 * somebody deciding whether to get one. The page is written for the first and
 * readable by the second, and the only thing the second cannot do here is mint a
 * key — see `CredentialPanel`, which offers them the paste box and a way to sign
 * in rather than a button that would fail.
 *
 * Two ways in, documented as one page. A **key** is for a script: one header,
 * one person's reach, no flow. **OAuth** is for software other people sign in
 * to: a consent screen, scopes, and tokens that can be taken back. They share
 * every endpoint under `/v1` — the authorizer resolves either credential into
 * the same identity — so they are one reference with one section about the
 * difference, rather than two documents that would drift apart.
 *
 * Being public is also why it wears `PublicHeader` rather than a bar of its own.
 * A reference is read by people with no account at all, and the bar over it is
 * the same bar the front page and the sign-in screen wear: one answer to "what is
 * this and how do I get in" across every page a stranger can open. What the page
 * needs beyond that — the way to a key and a v1 badge saying which API this is —
 * is on the page, above the fold, rather than in a bar that would then be the
 * only one of its kind.
 */

export const metadata: Metadata = {
  title: 'Play API reference — read Play from your own code',
  description:
    'The public, read-only API: courses, lessons, transcripts and media, authenticated with one x-api-key header. Every endpoint documented, with a playground.',
};
export default function ApiDocsPage() {
  // Step three of the quickstart is a real request, built from the same
  // reference the cards below are built from: the first call anybody makes with
  // a new key.
  const identityEndpoint = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints).find(
    (endpoint) => endpoint.id === 'get-me',
  );
  const quickstartCurl = identityEndpoint ? curlFor(identityEndpoint) : '';

  return (
    <div className="min-h-svh bg-muted/40">
      <PublicHeader />

      {/* No `items-start` here, and that is the whole of why the rail sticks.
          A sticky element cannot leave its containing block, so the aside has to
          be as tall as the column for the nav inside it to have anywhere to
          travel: `flex-start` would shrink the aside to the height of its own
          list, and the rail would scroll away with the page as if it were not
          sticky at all. Stretching it — the default — is what gives the rail its
          length to move through. */}
      <div className="mx-auto flex w-full max-w-6xl gap-10 px-6">
        <DocsRail />

        {/* The credential the whole page's playboxes run on lives in one
            provider, so a key is given once rather than once per endpoint. */}
        <PlaygroundProvider>
          <main className="min-w-0 flex-1 py-10">
            <section id="overview" className="scroll-mt-24">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-medium">
                  v1
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Read-only, by API key or OAuth
                </span>
              </div>

              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
                Read Play from your own code.
              </h1>
              <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
                The catalog a creator publishes to, the syllabus their learners read, and the
                lessons themselves — the video, the transcript, the notes and the files — reachable
                by a script, a partner&rsquo;s backend, or a classroom you build somewhere else.
                Bring an API key and read as its owner, or let people sign in to your app and read
                as them.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 text-card-foreground">
                <span className="text-xs text-muted-foreground">Base URL</span>
                <code className="min-w-0 flex-1 truncate font-mono text-sm">{API_BASE_URL}</code>
                {API_BASE_URL_IS_CONFIGURED ? (
                  <CopyButton value={API_BASE_URL} label="Copy" />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Set <span className="font-mono">NEXT_PUBLIC_API_URL</span> to your deployment
                  </span>
                )}
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Fact
                  icon={<KeyRoundIcon className="size-4" />}
                  title="Two ways in"
                  body="An x-api-key header for your own scripts. OAuth access tokens as Authorization: Bearer for apps other people sign in to."
                />
                <Fact
                  icon={<ShieldCheckIcon className="size-4" />}
                  title="Read-only"
                  body="A key reads courses, lessons and their media. It cannot write, publish, or change anything."
                />
                <Fact
                  icon={<ZapIcon className="size-4" />}
                  title="Revoked means revoked"
                  body="Nothing is cached in front of the credential check, so a revoked key — or an app somebody disconnected — stops on the next call."
                />
              </div>
            </section>

            {/* The credentials come before the endpoints, because the keys under
                /v1 are dead without one — and the endpoints that manage keys
                need nothing but the session this page already has. */}
            <div className="mt-16">
              <CredentialPanel />
            </div>

          <section id="quickstart" className="mt-16 scroll-mt-24">
              <h2 className="text-2xl font-semibold tracking-tight">Quickstart</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Three steps, and the third one tells you whether it worked.
              </p>

              <div className="mt-6 grid gap-6">
                <Step step={1} title="Make a key">
                  <p className="text-sm text-muted-foreground">
                    In the studio, under your account menu — making one takes an account, because a
                    key belongs to somebody. The secret is shown once: we keep a hash of it, so copy
                    it somewhere safe before you close the dialog. Reading this page needs nothing.
                  </p>
                  <Button asChild variant="secondary" size="sm" className="mt-3 w-fit">
                    <Link href="/api-keys">
                      <KeyRoundIcon />
                      Go to API keys
                      <ArrowRightIcon />
                    </Link>
                  </Button>
                </Step>

                <Step step={2} title="Put it in your environment">
                  <CodeBlock label="Shell" code={`export PLAY_API_KEY="play_sk_…"`} />
                  <p className="mt-3 text-sm text-muted-foreground">
                    An environment variable rather than a literal, so the key stays out of your source
                    code, your shell history and your screenshots.
                  </p>
                </Step>

                <Step step={3} title="Ask who you are">
                  <CodeBlock label="cURL" code={quickstartCurl} />
                  <p className="mt-3 text-sm text-muted-foreground">
                    A <span className="font-mono">200</span> comes back with the key&rsquo;s name, when
                    it was last used, and the organization it reaches — which is the one thing that
                    decides whether the organization endpoints below will answer.
                  </p>
                </Step>
              </div>
            </section>

            <section id="authentication" className="mt-16 scroll-mt-24">
              <h2 className="text-2xl font-semibold tracking-tight">Authentication</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Every call under <span className="font-mono">/v1</span> takes one of two credentials,
                in one of two headers. Nothing else about the call changes: the same endpoints, the
                same shapes, the same authorizer deciding who you are.
              </p>

              <div className="mt-6 overflow-hidden rounded-3xl border border-border/60 bg-card text-card-foreground shadow-sm">
                <pre className="overflow-x-auto px-5 py-4 font-mono text-xs leading-relaxed">
  {`# A key: one header, no flow, acts as its owner.
GET /v1/courses HTTP/1.1
Host: ${API_BASE_URL.replace(/^https?:\/\//, '')}
x-api-key: play_sk_9f2c1a4b7d8e0f1a2b3c4d5e6f7a8b9c

# An access token: what an app holds after somebody authorized it.
GET /v1/courses HTTP/1.1
Host: ${API_BASE_URL.replace(/^https?:\/\//, '')}
Authorization: Bearer play_at_3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c`}
                </pre>
              </div>

              {/* The reach of a key is the question every 403 raises, so it is
                answered where authentication is explained rather than left to
                be inferred from which endpoints happen to work. */}
            <div className="mt-6 rounded-3xl border border-border/60 bg-card p-5 text-card-foreground">
              <h3 className="text-base font-semibold tracking-tight">What a key can read</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                The published catalog is open to any key. Everything else is authorized the way the
                signed-in apps are, with the key standing in for the person who made it:
              </p>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-1 rounded-2xl border border-border/60 px-4 py-3 sm:grid-cols-[15rem_1fr] sm:gap-4">
                  <p className="text-sm font-medium">A personal key</p>
                  <p className="text-sm text-muted-foreground">
                    Reaches what its owner may read: their own organizations&rsquo; courses, and the
                    courses they are registered for.
                  </p>
                </div>
                <div className="grid gap-1 rounded-2xl border border-border/60 px-4 py-3 sm:grid-cols-[15rem_1fr] sm:gap-4">
                  <p className="text-sm font-medium">A key made for an organization</p>
                  <p className="text-sm text-muted-foreground">
                    Reaches everything that organization owns — every course, published or not, and
                    its lessons. That is the key to build a classroom with, and any member can make
                    one; its admins can see it and revoke it.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-border/60 bg-card p-5 text-card-foreground">
              <h3 className="text-base font-semibold tracking-tight">What an app can read</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Behind a person&rsquo;s consent, and no further than the scopes they agreed to. The
                app acts as them — it reads what they may read, never more — and this is the whole
                catalogue of what it can be given:
              </p>
              <dl className="mt-4 divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60">
                {OAUTH_SCOPE_DOCS.map((entry) => (
                  <div
                    key={entry.scope}
                    className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4"
                  >
                    <dt className="min-w-0 font-mono text-xs text-muted-foreground">
                      {entry.scope}
                    </dt>
                    <dd className="min-w-0">
                      <p className="text-sm font-medium">{entry.title}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {renderEmphasis(entry.reach)}
                      </p>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                An API key holds every one of these except{' '}
                <span className="font-mono">profile:read</span>, plus{' '}
                <span className="font-mono">organization:courses:read</span> when it was made for an
                organization. Nothing writes: <span className="font-mono">/v1</span> is read-only for
                both credentials.
              </p>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Fact
                  icon={<BracesIcon className="size-4" />}
                  title="Secrets are stored as hashes"
                  body="We keep a SHA-256 of a key, a client secret, a code or a token, and never the value itself. Nobody — not an admin, not support — can read one back, so a lost credential is replaced rather than recovered."
                />
                <Fact
                  icon={<ShieldCheckIcon className="size-4" />}
                  title="A key acts as its owner"
                  body="Every read is attributed to the person who made it, and to the organization it was made for. Revoking it, by them or by that organization's admins, ends it."
                />
                <Fact
                  icon={<KeyRoundIcon className="size-4" />}
                  title="Managing credentials takes a session"
                  body="The endpoints that mint and revoke keys and apps are called with a signed-in session token, not with a key. A credential cannot mint another credential."
                />
                <Fact
                  icon={<ZapIcon className="size-4" />}
                  title="Nothing is cached"
                  body="The authorizer is invoked on every request, so revoking a key — or disconnecting an app — takes effect immediately rather than within the hour a caching authorizer would take."
                />
              </div>
            </section>

            {/* The flow, in five steps rather than as an endpoint list: an
                integrator reading this is holding an OAuth library and needs to
                know what the library is doing, not only which URLs exist. The
                endpoint cards for all of it are in the groups below. */}
            <section id="oauth" className="mt-16 scroll-mt-24">
              <h2 className="text-2xl font-semibold tracking-tight">
                Signing people in with OAuth
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                For software other people sign in to. Instead of one credential that acts as one
                person forever, an app asks each of them for permission on a screen, reads as them
                and no further than they allowed, and can be cut off by any of them — or by all of
                them at once when the app is deleted.
              </p>

              <div className="mt-6 grid gap-6">
                <Step step={1} title="Register the app">
                  <p className="text-sm text-muted-foreground">
                    In the studio, under OAuth apps. You get a client id, a client secret (or none
                    at all, if it is a public client), and you say where the app is allowed to be
                    sent back to. That redirect URI is matched exactly, forever after.
                  </p>
                  <Button asChild variant="secondary" size="sm" className="mt-3 w-fit">
                    <Link href="/oauth/apps">
                      <SquareCodeIcon />
                      Go to OAuth apps
                      <ArrowRightIcon />
                    </Link>
                  </Button>
                </Step>

                <Step step={2} title="Send people to the consent screen">
                  <p className="text-sm text-muted-foreground">
                    Your client builds a URL with a client id, a redirect URI, the scopes it wants,
                    some <span className="font-mono">state</span>, and a PKCE{' '}
                    <span className="font-mono">code_challenge</span> — and opens it. Play draws the
                    screen: what your app is, what it is asking for, and who is signed in. Nobody
                    types a Play password into your app, because nobody signs in anywhere but here.
                  </p>
                  {/* Written as a joined array rather than as one template
                      literal across several lines: inside a template literal a
                      backslash before a newline is a *line continuation*, so the
                      newlines disappear and what looks like six lines here is
                      one 380-character string in the DOM — a code block that
                      cannot wrap, and a layout that cannot shrink. */}
                  <CodeBlock
                    label="The URL your client opens"
                    code={[
                      'https://<your-studio>/oauth/authorize?',
                      '  client_id=play_app_7c1d9e2f4a6b8c0d&',
                      '  redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fplay%2Fcallback&',
                      '  response_type=code&',
                      '  scope=profile%3Aread+courses%3Aread&',
                      '  state=a1b2c3d4&',
                      '  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&',
                      '  code_challenge_method=S256',
                    ].join('\n')}
                  />
                </Step>

                <Step step={3} title="Take the code back to your server">
                  <p className="text-sm text-muted-foreground">
                    The browser comes back to your redirect URI with{' '}
                    <span className="font-mono">code</span> and your{' '}
                    <span className="font-mono">state</span> — check the state, then exchange the code
                    at <span className="font-mono">POST /oauth/token</span> with the verifier your
                    client kept. The code is single-use and lives sixty seconds.
                  </p>
                  <CodeBlock
                    label="Exchanging the code"
                    code={`curl -X POST "${API_BASE_URL}/oauth/token" \\
  -d grant_type=authorization_code \\
  -d code=$CODE \\
  -d redirect_uri=https://example.com/auth/play/callback \\
  -d code_verifier=$VERIFIER \\
  -d client_id=$PLAY_CLIENT_ID \\
  -d client_secret=$PLAY_CLIENT_SECRET`}
                  />
                </Step>

                <Step step={4} title="Call the API as them">
                  <CodeBlock
                    label="cURL"
                    code={`curl "${API_BASE_URL}/v1/me/profile" \\
  -H "Authorization: Bearer $ACCESS_TOKEN"`}
                  />
                  <p className="mt-3 text-sm text-muted-foreground">
                    An hour later the access token expires. Spend the refresh token at the same
                    endpoint and you get a new pair — and the refresh token rotates, so store the
                    new one every time rather than the one you had.
                  </p>
                </Step>

                <Step step={5} title="Be a good citizen">
                  <p className="text-sm text-muted-foreground">
                    Handle <span className="font-mono">error=access_denied</span> as an answer rather
                    than a failure — somebody pressed Cancel, and that is allowed. Ask for the scopes
                    you actually use. Revoke at{' '}
                    <span className="font-mono">POST /oauth/revoke</span> when somebody deletes
                    their account from your app. And expect a{' '}
                    <span className="font-mono">403</span> that names a scope: it means the person
                    is still connected but granted you less than this call needs.
                  </p>
                </Step>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Fact
                  icon={<ShieldCheckIcon className="size-4" />}
                  title="PKCE is required of everybody"
                  body="S256, on every client, public or confidential. A code travels through a browser, a redirect and usually a log; the verifier never leaves the client."
                />
                <Fact
                  icon={<ZapIcon className="size-4" />}
                  title="Disconnecting is immediate"
                  body="Deleting a grant deletes the tokens under it, and nothing is cached in front of the check, so the app's next call is refused rather than one within the hour."
                />
                <Fact
                  icon={<KeyRoundIcon className="size-4" />}
                  title="No password ever reaches an app"
                  body="The consent screen is this app. An app receives a code, then tokens — never a credential a person typed."
                />
                <Fact
                  icon={<BracesIcon className="size-4" />}
                  title="No client_credentials grant"
                  body="An app that acts as itself with nobody behind it is what an API key already is, with a screen for making one. Adding it here would be a second answer to a question that has one."
                />
              </div>
            </section>

            {API_ENDPOINT_GROUPS.map((group) => (
              <section key={group.id} id={group.id} className="mt-16 scroll-mt-24">
                <h2 className="text-2xl font-semibold tracking-tight">{group.title}</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{group.description}</p>

                <div className="mt-6 grid gap-6">
                  {group.endpoints.map((endpoint) => (
                    <EndpointCard key={endpoint.id} endpoint={endpoint} />
                  ))}
                </div>
              </section>
            ))}

            <section id="errors" className="mt-16 scroll-mt-24">
              <h2 className="text-2xl font-semibold tracking-tight">Errors</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Anything the endpoint itself refuses comes back as JSON with the status in both places
                a client looks: the response code, and a body it can print.
              </p>

              <div className="mt-6 grid gap-6">
                <CodeBlock label="403 Forbidden · application/json" code={API_ERROR_EXAMPLE} />

                <dl className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60 bg-card text-card-foreground">
                  {API_ERRORS.map((error) => (
                    <div key={error.status} className="flex items-start gap-4 px-5 py-3.5">
                      <dt className="w-10 shrink-0 font-mono text-sm font-medium">{error.status}</dt>
                      <dd className="text-sm text-muted-foreground">{error.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>

            <section id="conventions" className="mt-16 scroll-mt-24 pb-16">
              <h2 className="text-2xl font-semibold tracking-tight">Conventions</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Four things that are true of every endpoint here.
              </p>

              <dl className="mt-6 divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60 bg-card text-card-foreground">
                <Convention title="Paging">
                  Lists come back with a <Code>nextToken</Code>. Pass it back as the{' '}
                  <Code>nextToken</Code> query parameter to read the next page, and stop when it is
                  absent. It is opaque — it encodes the last row read, so changing it does not mean
                  what you might hope.
                </Convention>
                <Convention title="Timestamps">
                  Every time in this API is epoch milliseconds in UTC, as a number. Nothing is a
                  formatted date string, because a client that has to parse one has to guess a locale.
                </Convention>
                <Convention title="Publication and access">
                  Two different questions. The <em>catalog</em> holds the courses their authors
                  published, where an unpublished one answers <Code>404</Code> so that it never
                  reports which ids exist in private. The <em>lesson</em> endpoints are authorized by
                  access instead: they answer for any course the key may read, published or not, and
                  answer <Code>403</Code> for one it may not.
                </Convention>
                <Convention title="Versioning">
                  Everything is under <Code>/v1</Code>. Within a version, changes are additive — a new
                  field, a new endpoint — and nothing that exists today is renamed or removed.
                </Convention>
                <Convention title="Cross-origin">
                  Every response carries <Code>Access-Control-Allow-Origin: *</Code>, the ones API
                  Gateway produces before a function runs included — which is what lets this page&rsquo;s
                  Send buttons read a 401 or a 403 instead of it arriving as an unexplained network
                  failure. The API is readable from any origin by design; the key is what limits it.
                </Convention>
              </dl>
            </section>
        </main>
        </PlaygroundProvider>
      </div>
    </div>
  );
}

/** One of the short claims near the top: an icon, a sentence, and a reason. */
function Fact({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-5 py-4 text-card-foreground">
      <div className="flex size-8 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        {icon}
      </div>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

/** A numbered step of the quickstart, with its content under the number. */
function Step({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  // `min-w-0` on the section: a grid item does not shrink below its content's
  // minimum width unless it is told to, and these steps carry code blocks — so a
  // long command would otherwise set the width of the whole page rather than
  // scrolling inside its own box.
  return (
    <section className="min-w-0 rounded-3xl border border-border/60 bg-card p-6 text-card-foreground shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/70 text-xs font-medium">
          {step}
        </span>
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** One line of the conventions list: a name, and what it says. */
function Convention({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6">
      <dt className="text-sm font-medium">{title}</dt>
      <dd className="text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

/** An inline code span, for the conventions list's prose. */
function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-foreground">{children}</code>;
}
