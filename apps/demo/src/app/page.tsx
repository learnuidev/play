'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRightIcon, KeyRoundIcon, RefreshCwIcon, ShieldCheckIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { useSession } from '@/lib/oauth/session';
import { CALLBACK_PATH, SCOPES, STUDIO_URL, isConfidential } from '@/lib/oauth/config';
import { SetupCard } from '@/components/setup-card';
import { IdentityPanel } from '@/components/identity-panel';
import { SecretWarning } from '@/components/secret-warning';

/**
 * The front page: what this app is, and the one button that makes it work.
 *
 * Written as a demonstration rather than as a product page, because that is what
 * it is. A reader is meant to come away knowing three things: this app has no
 * accounts of its own, it holds a credential that acts as *them*, and that
 * credential reaches exactly what a consent screen said it would.
 *
 * The page is careful to be readable before anything is connected — the setup
 * instructions are the first thing a newcomer sees, and the explanation of the
 * flow is below them rather than behind a sign-in.
 */
export default function HomePage() {
  const { ready, signedIn, configured, signIn } = useSession();
  const [redirectUri, setRedirectUri] = useState(`http://localhost:4000${CALLBACK_PATH}`);

  // Derived from the browser's own origin, exactly as Play's own apps derive
  // theirs — so the same build works at whatever address it is served from, and
  // the value on the setup card is the value Play will actually be asked for.
  useEffect(() => {
    setRedirectUri(`${window.location.origin}${CALLBACK_PATH}`);
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <section className="max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          <KeyRoundIcon className="size-3" />
          OAuth 2.0 with PKCE · no client secret
        </span>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
          A classroom that isn&rsquo;t ours.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          Fieldnotes is a small app for reading a course: the outline, the lesson, the video, the
          captions and the material beside them. It has no database and no sign-in of its own. It
          asks Play for permission, and then it reads what Play lets it.
        </p>
      </section>

      {isConfidential() && <SecretWarning />}

      {!configured ? (
        <div className="mt-10">
          <SetupCard redirectUri={redirectUri} />
        </div>
      ) : !signedIn ? (
        <div className="mt-10 rounded-3xl border border-border/60 bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="text-base font-semibold tracking-tight">Read your own courses</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            This takes you to Play&rsquo;s consent screen, which is where you sign in — not here.
            This app never sees a password of yours. You come back with a credential, and this app
            then reads the courses <em>you</em> can read.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={() => void signIn('/courses')}>
              Connect your Play account
              <ArrowRightIcon />
            </Button>
            <span className="text-xs text-muted-foreground">
              Asks for {SCOPES.length} permissions — reads, your learning record, and one that
              posts as you. They are listed below.
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-10">
          <IdentityPanel />
        </div>
      )}

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <Fact
          icon={<ShieldCheckIcon className="size-4" />}
          title="Nothing is a password"
          body="You sign in on Play's own screen, in Play's own address bar. This app is handed a code, and then tokens — never a credential you typed."
        />
        <Fact
          icon={<KeyRoundIcon className="size-4" />}
          title="PKCE stands in for a secret"
          body="A browser app cannot keep a secret, so this one does not have one. It proves it is the same app that started the flow by presenting a verifier the consent screen never saw."
        />
        <Fact
          icon={<RefreshCwIcon className="size-4" />}
          title="Access is one hour, and revocable"
          body="The access token lasts an hour and is renewed from a rotating refresh token. Disconnect, here or on Play's connections screen, and every token this app holds is deleted."
        />
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">The flow, end to end</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Four endpoints, and everything this app does is one of them. The same four are documented
          in Play&rsquo;s API reference.
        </p>

        <ol className="mt-6 grid gap-3">
          <FlowStep
            title="1 · Send the browser to the consent screen"
            endpoint={`GET ${STUDIO_URL}/oauth/authorize`}
            body="With this app's client id, the scopes it is asking for, a random state, and the SHA-256 of a verifier this app just invented. Play draws the screen and decides nothing on its own."
          />
          <FlowStep
            title="2 · Come back with a code"
            endpoint={`GET ${redirectUri}`}
            body="The browser lands back here with code and state. The state is checked against the one that was parked a moment ago — a callback carrying somebody else's code is not this session's."
          />
          <FlowStep
            title="3 · Spend the code"
            endpoint="POST /oauth/token"
            body="Form-encoded, with client_id and the verifier — and no client secret, because there is not one. An access token comes back, good for an hour, and a refresh token good for thirty days."
          />
          <FlowStep
            title="4 · Read, and renew"
            endpoint="GET /v1/courses"
            body="Every call carries the access token as a bearer token. When it expires, the refresh token buys a new pair — and it rotates, so the old one stops working the moment it is spent."
          />
        </ol>
      </section>

      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        <div className="rounded-3xl border border-border/60 bg-card p-6 text-card-foreground">
          <h2 className="text-base font-semibold tracking-tight">What it asks for</h2>
          <ul className="mt-3 grid gap-2">
            {SCOPES.map((scope) => (
              <li key={scope}>
                <span className="font-mono text-xs text-muted-foreground">{scope}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Read-only, and four is the whole of it: who you are, what has been published, what a
            course contains, and the video. There is nothing here that writes anything.
          </p>
        </div>

        <div className="rounded-3xl border border-border/60 bg-card p-6 text-card-foreground">
          <h2 className="text-base font-semibold tracking-tight">What it cannot do</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            It cannot reach a course you cannot: the token acts as you, so somebody else&rsquo;s
            unpublished course is a 403 whether it is asked for here or anywhere else. It cannot
            enrol you in anything, delete a lesson, or change a course. Of the three things it can
            write — your progress, your favourites, a comment — none is anybody else&rsquo;s to
            change, and a comment can be withdrawn in Play but not from here.
          </p>
        </div>
      </section>

      <p className="mt-12 text-xs leading-relaxed text-muted-foreground">
        {ready && signedIn ? (
          <Link href="/courses" className="underline underline-offset-4">
            Go to the classroom
          </Link>
        ) : (
          <>
            Not sure where to start? <span className="font-mono">apps/demo/README.md</span> has the
            setup in four steps.
          </>
        )}
      </p>
    </div>
  );
}

/** One short claim, in the reference's own voice. */
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
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/** One leg of the flow: what happens, and which endpoint does it. */
function FlowStep({
  title,
  endpoint,
  body,
}: {
  title: string;
  endpoint: string;
  body: string;
}) {
  return (
    <li className="grid gap-1.5 rounded-2xl border border-border/60 bg-card p-5 text-card-foreground sm:grid-cols-[14rem_1fr] sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{endpoint}</p>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}
