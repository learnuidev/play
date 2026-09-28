'use client';

import { CheckIcon } from 'lucide-react';
import { API_SCOPES, type ApiScope } from '@play/types';
import { cn } from '@ui/lib/utils';
import { OAUTH_SCOPE_COPY } from '@/lib/oauth-scopes';

/**
 * A scope, drawn the same way wherever one is shown.
 *
 * Three screens show scopes — the consent screen, the app's own settings, and a
 * connection — and they must not disagree about what a scope is called, because
 * the whole point of the vocabulary is that somebody recognizes on their
 * connections screen the sentence they agreed to on a consent screen.
 *
 * The only thing that varies is the mark: the consent screen ticks what is being
 * granted, the settings page offers a box to tick, and a connection lists what is
 * already held. Hence `mark`, which is the caller's business.
 */

/**
 * What a scope is called, falling back to the scope itself.
 *
 * The catalogue is a *copy* of the service's, and a copy can be behind: the API
 * can be deployed with a scope this build of the studio has never heard of, and
 * a grant written before a scope was renamed still carries the old name. Neither
 * is a reason for a page to disappear — and an unguarded index into a record is
 * exactly that, a thrown `TypeError` in the middle of a render. So an unknown
 * scope is drawn as its own id, which is at least true, with a sentence saying
 * what it is rather than what it does.
 */
function copyOf(scope: ApiScope) {
  return (
    OAUTH_SCOPE_COPY[scope] ?? {
      title: scope,
      description: 'A permission this version of the studio does not know about.',
    }
  );
}

function ScopeText({ scope, note }: { scope: ApiScope; note?: string }) {
  const copy = copyOf(scope);
  return (
    <span className="min-w-0">
      <span className="block text-sm font-medium">{copy.title}</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
        {note ?? copy.description}
      </span>
    </span>
  );
}

/** One scope, as a sentence with a tick beside it. Used where consent is given. */
export function ScopeGrantRow({
  scope,
  granted,
  note,
}: {
  scope: ApiScope;
  /** Already agreed to before this screen: ticked either way, marked as known. */
  granted?: boolean;
  note?: string;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
          granted ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
        )}
      >
        <CheckIcon className="size-3" />
      </span>
      <ScopeText scope={scope} {...(note ? { note } : {})} />
      {granted && (
        <span className="ml-auto shrink-0 self-center text-xs text-muted-foreground">
          Already allowed
        </span>
      )}
    </li>
  );
}

/**
 * The scopes an app may be registered for, as a list of boxes.
 *
 * A checkbox rather than a radio group, because an app's permissions are a set
 * and not a level: "read courses but not the people who teach them" is a
 * perfectly ordinary thing to want, and a scale from "less" to "more" would make
 * it unexpressible.
 */
export function ScopeChecklist({
  selected,
  onChange,
  disabled,
}: {
  selected: ApiScope[];
  onChange: (next: ApiScope[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2">
      {API_SCOPES.map((scope) => {
        const checked = selected.includes(scope);
        return (
            <label
              key={scope}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
                checked ? 'border-ring bg-muted/50' : 'hover:bg-muted/40',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() =>
                  onChange(
                    checked ? selected.filter((entry) => entry !== scope) : [...selected, scope],
                  )
                }
                className="mt-0.5 size-4 shrink-0 accent-foreground"
              />
              <ScopeText scope={scope} />
            </label>
          );
        })}
    </div>
  );
}

/** The scopes a grant holds, as a row of pills. Used where there is nothing to do. */
export function ScopePills({ scopes }: { scopes: ApiScope[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {scopes.map((scope) => (
        <li
          key={scope}
          className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
        >
          {copyOf(scope).title}
        </li>
      ))}
    </ul>
  );
}
