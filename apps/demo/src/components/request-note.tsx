import { ArrowUpRightIcon } from 'lucide-react';
import { API_BASE_URL } from '@/lib/oauth/config';

/**
 * What a page asked the API for, under the page itself.
 *
 * A demo's most useful feature is being readable as one: a person looking at
 * this app wants to know which endpoints produced what is on the screen, so that
 * the screen stops being magic and becomes six documented calls. Every page ends
 * with one of these, and the paths are the same strings the API reference uses.
 */
export function RequestNote({ endpoints }: { endpoints: string[] }) {
  return (
    <aside className="mt-10 rounded-2xl border border-dashed border-border/70 px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground">
        This page read Play with the access token it was given:
      </p>
      <ul className="mt-2 grid gap-1">
        {endpoints.map((endpoint) => (
          <li key={endpoint}>
            <a
              href={`${API_BASE_URL}${endpoint.split(' ').pop() ?? endpoint}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {endpoint}
              <ArrowUpRightIcon className="size-3" />
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Every one of them is in{' '}
        <a
          href={`${process.env.NEXT_PUBLIC_PLAY_STUDIO_URL ?? 'http://localhost:3000'}/docs`}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-4"
        >
          Play&rsquo;s API reference
        </a>
        . Some need a scope this app asked for; a call outside them answers 403 and names the scope
        it wanted.
      </p>
    </aside>
  );
}
