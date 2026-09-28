'use client';

import { CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@ui/components/ui/button';
import { SCOPES, STUDIO_URL } from '@/lib/oauth/config';

/**
 * What to do when this app has not been registered yet.
 *
 * Which is the first thing anybody sees, because a client id cannot be derived —
 * it is minted when somebody registers an app in the studio, on purpose, by a
 * person. So this app explains itself instead of failing: the exact values to
 * paste into that form, in the order the form asks for them, including the two
 * that are easy to get wrong.
 *
 * The two that are easy to get wrong, and why they are called out:
 *
 * - **The redirect URI has to match exactly.** Not a prefix, not a wildcard:
 *   `http://localhost:4000/auth/callback`, port and all. It is where Play sends
 *   somebody back to with a code that acts as them, so an approximate match
 *   would be an open redirect.
 * - **The app has to be registered for `lessons:stream`.** A new app starts with
 *   three scopes and this one asks for four, because it plays video. Requesting a
 *   scope the app is not registered for fails the whole authorization request
 *   rather than quietly dropping it — which is the right behaviour and a
 *   confusing first experience if nobody says so.
 */
export function SetupCard({ redirectUri }: { redirectUri: string }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 text-card-foreground shadow-sm">
      <h2 className="text-base font-semibold tracking-tight">One setup step first</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        This app needs a client id, and a client id comes from registering it. It takes a minute,
        and it is what makes the consent screen say whose app this is.
      </p>

      <ol className="mt-5 grid gap-4">
        <Step n={1} title="Open OAuth apps in the studio">
          <p className="text-sm text-muted-foreground">
            Register a new app. Play draws the consent screen from what you put here, so the name
            and the sentence are what somebody will read before deciding whether to trust it.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-3 w-fit">
            <a href={`${STUDIO_URL}/oauth/apps`} target="_blank" rel="noreferrer noopener">
              Open OAuth apps
            </a>
          </Button>
        </Step>

        <Step n={2} title="Fill the form in with these">
          <dl className="grid gap-2">
            <Field label="Name" value="Fieldnotes" />
            <Field
              label="What does it do?"
              value="A read-only study companion: your courses, lessons and transcripts in one place."
            />
            <Field label="Redirect URI" value={redirectUri} />
            <Field
              label="And add"
              value="http://127.0.0.1:4000/auth/play/callback"
            />
            <Field label="Scopes" value={SCOPES.join(' ')} />
            <Field label="Public client?" value="Yes — it runs in a browser and keeps no secret" />
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The last one is the interesting choice: a public client has no secret at all and proves
            itself with PKCE instead. A secret shipped inside a browser bundle is not a secret, so
            asking for one would be worse than useless.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Both redirect URIs go on the list, because <span className="font-mono">localhost</span>{' '}
            and <span className="font-mono">127.0.0.1</span> are different origins to a browser and
            Play matches exactly. An app may have up to ten, and leaving one out is the usual
            reason a sign-in fails with &ldquo;redirect_uri is not registered&rdquo;.
          </p>
        </Step>

        <Step n={3} title="Put the client id in this app's environment">
          <p className="text-sm text-muted-foreground">
            Copy the client id out of the app you just registered and add it to{' '}
            <span className="font-mono text-xs">apps/demo/.env.local</span>, then restart this app.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl border bg-muted/40 px-4 py-3 font-mono text-xs">
            {`NEXT_PUBLIC_PLAY_CLIENT_ID=play_app_…`}
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            No client secret goes here — there is not one to copy, because you registered a public
            client. That is the whole design.
          </p>
        </Step>
      </ol>

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Already registered? Set{' '}
        <span className="font-mono">NEXT_PUBLIC_PLAY_CLIENT_ID</span> and reload. The redirect URI
        has to be on the app&rsquo;s list as{' '}
        <span className="font-mono">{redirectUri}</span> — this build is served from port 4000.
      </p>
    </div>
  );
}

/** One field to paste into the studio's form, with a copy button. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-border/60 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 break-words font-mono text-xs">{value}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => toast.success('Copied'))
              .catch(() => toast.error('Could not copy to the clipboard', { description: value }));
          }}
        >
          <CopyIcon className="size-3.5" />
        </Button>
      </dd>
    </div>
  );
}

/** One numbered step, as the API reference's quickstart draws them. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-border/60 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/70 text-xs font-medium">
          {n}
        </span>
        <p className="text-sm font-medium">{title}</p>
      </div>
      <div className="mt-3">{children}</div>
    </li>
  );
}
