import { Badge } from '@ui/components/ui/badge';
import { cn } from '@ui/lib/utils';
import { API_AUTH_LABELS, type ApiEndpoint, type ApiField } from '@/lib/api-reference';
import { curlFor } from '@/lib/api-example';
import { CodeBlock } from './code-block';
import { TryIt } from './try-it';

/**
 * The method, as a colour and a word.
 *
 * Colour is what makes a page of endpoints scannable — a reader looking for the
 * one that writes something is looking for the one that is not green — and the
 * word stays beside it because colour alone is not an answer for everybody.
 */
const METHOD_STYLES: Record<ApiEndpoint['method'], string> = {
  GET: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  POST: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  DELETE: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
};

function MethodBadge({ method }: { method: ApiEndpoint['method'] }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1 font-mono text-xs font-semibold',
        METHOD_STYLES[method],
      )}
    >
      {method}
    </span>
  );
}

/** A block heading inside an endpoint card. */
function FieldHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold tracking-tight">{children}</h3>;
}

/**
 * Fields, as a definition list rather than a table.
 *
 * A table of four columns on a phone is a horizontal scrollbar, and the thing
 * being read here is one field at a time: its name, what type it is, and a
 * sentence about it. Type and required state sit on the name's line so the eye
 * lands on the name first.
 */
function FieldList({ fields }: { fields: ApiField[] }) {
  return (
    <dl className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60">
      {fields.map((field) => (
        <div key={field.name} className="grid gap-1 px-4 py-3">
          <dt className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm font-medium">{field.name}</code>
            <span className="font-mono text-xs text-muted-foreground">{field.type}</span>
            {field.required && (
              <Badge variant="secondary" className="font-medium">
                Required
              </Badge>
            )}
          </dt>
          <dd className="text-sm text-muted-foreground">{field.description}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One endpoint, in full: what it does, what it takes, what comes back.
 *
 * Everything about a call is on one card and nothing is behind a disclosure. A
 * reference that hides the response behind a click is a reference somebody
 * clicks twice for every endpoint, and the shape of the answer is the thing
 * being looked up.
 */
export function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  return (
    <article
      id={endpoint.id}
      className="scroll-mt-24 overflow-hidden rounded-3xl border border-border/60 bg-card text-card-foreground shadow-sm"
    >
      <header className="border-b border-border/40 px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <MethodBadge method={endpoint.method} />
          <code className="min-w-0 truncate font-mono text-sm">{endpoint.path}</code>
          <Badge variant="outline" className="ml-auto shrink-0 font-normal">
            {API_AUTH_LABELS[endpoint.auth]}
          </Badge>
        </div>

        <p className="mt-4 text-lg font-medium tracking-tight">{endpoint.summary}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{endpoint.description}</p>

        {endpoint.notes && endpoint.notes.length > 0 && (
          <ul className="mt-4 grid gap-2">
            {endpoint.notes.map((note) => (
              <li
                key={note}
                className="rounded-xl border border-border/60 bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground"
              >
                {renderEmphasis(note)}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="grid gap-8 px-6 py-6">
        {/* The playground comes first, and above the reference rather than under
            it: the reason somebody scrolls to one of these is usually to find
            out what it answers, and the answer to that is a Send button. */}
        <TryIt endpoint={endpoint} />

        {endpoint.parameters && endpoint.parameters.length > 0 && (
          <section className="grid gap-3">
            <FieldHeading>Parameters</FieldHeading>
            <FieldList fields={endpoint.parameters} />
          </section>
        )}

        <section className="grid gap-3">
          <FieldHeading>Request body</FieldHeading>
          {endpoint.body && endpoint.body.length > 0 ? (
            <FieldList fields={endpoint.body} />
          ) : (
            <p className="rounded-2xl border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground">
              None. The endpoint is addressed entirely by its path
              {endpoint.parameters?.some((parameter) => parameter.in === 'query')
                ? ' and query string'
                : ''}
              .
            </p>
          )}
        </section>

        <section className="grid gap-3">
          <FieldHeading>Request</FieldHeading>
          <CodeBlock code={curlFor(endpoint)} label="cURL" />
        </section>

        <section className="grid gap-3">
          <FieldHeading>Response</FieldHeading>
          <CodeBlock code={endpoint.responseExample} label="200 OK · application/json" />
          <FieldList fields={endpoint.responseFields} />
        </section>
      </div>
    </article>
  );
}

/**
 * The two bits of emphasis the notes use — `code` and **bold**.
 *
 * Written as a tiny renderer rather than as JSX in the data, so the reference
 * stays one object per endpoint: a note that had to be split into spans would be
 * a note nobody adds to.
 */
function renderEmphasis(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="font-mono text-foreground">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}
