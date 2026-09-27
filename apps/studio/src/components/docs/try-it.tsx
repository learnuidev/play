'use client';

import { useEffect, useMemo, useState } from 'react';
import { RotateCcwIcon, SendIcon, TriangleAlertIcon, ZapIcon } from 'lucide-react';
import { useIsSignedIn } from '@play/auth';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { cn } from '@ui/lib/utils';
import { API_CHOICE_TITLES, type ChoiceScope } from '@/lib/api-choices';
import { useApiKeyDefaults, type ApiKeyDefaults } from '@/lib/api-key-defaults';
import type { ApiEndpoint, ApiField } from '@/lib/api-reference';
import {
  PlaygroundRequestError,
  isGatewayResponse,
  playgroundUrl,
  runEndpoint,
  type PlaygroundResult,
  type PlaygroundValues,
} from '@/lib/api-playground';
import { CodeBlock } from './code-block';
import { FieldPicker } from './field-picker';
import { usePlayground } from './playground-context';

/**
 * The values a request starts with.
 *
 * Path parameters and body fields are seeded with the documented examples,
 * because without them there is no request to make. Query parameters are left
 * empty, because they are refinements and an empty one is a real choice: `GET
 * /v1/courses` with no query string lists the catalog, which is what somebody
 * pressing Send on it means. The example is still in the field's placeholder,
 * so what could go there is one glance away.
 */
function startingValues(endpoint: ApiEndpoint): PlaygroundValues {
  const values: PlaygroundValues = { path: {}, query: {}, body: {} };

  for (const parameter of endpoint.parameters ?? []) {
    if (parameter.in === 'path') values.path[parameter.name] = parameter.example ?? '';
  }

  for (const field of endpoint.body ?? []) {
    values.body[field.name] = field.example ?? '';
  }

  return values;
}

/** A 2xx, 4xx or 5xx badge, in the same colours the method badges use. */
function statusClass(status: number): string {
  if (status < 300) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (status < 500) return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'bg-rose-500/10 text-rose-700 dark:text-rose-400';
}

/**
 * The same values, with every field the key already knows the answer to filled
 * in — the organization, its course, and a lesson in it.
 *
 * The reference's examples say where a value goes; a key made for an
 * organization says what actually goes there, and the two disagree in every
 * place that matters: an example course id names a course that does not exist,
 * so a page left as it arrived answers 404 to a reader who has just installed a
 * key and wants to see something real come back.
 *
 * With no such key this puts the documented examples back, which is what makes
 * forgetting a key return the page to its untouched state rather than leaving an
 * organization behind that is no longer the one being called with.
 */
function withKeyDefaults(
  values: PlaygroundValues,
  endpoint: ApiEndpoint,
  defaults: ApiKeyDefaults | undefined,
): PlaygroundValues {
  const next: PlaygroundValues = {
    path: { ...values.path },
    query: { ...values.query },
    body: { ...values.body },
  };
  let filled = false;

  /**
   * What a field should say: the key's own answer when it has one, and the
   * example it documents when it does not. A field that names nothing the key
   * knows about keeps whatever is in it — a title, a limit, a search term.
   */
  const fill = (where: keyof PlaygroundValues, field: ApiField) => {
    const current = next[where][field.name] ?? '';
    let value = current;

    switch (field.choices) {
      case 'organizations':
        value = defaults?.orgId ?? field.example ?? '';
        break;
      case 'courses':
        value = defaults?.spaceId ?? field.example ?? '';
        break;
      case 'lessons':
        value = defaults?.contentId ?? field.example ?? '';
        break;
    }

    if (value !== current) filled = true;
    next[where][field.name] = value;
  };

  for (const parameter of endpoint.parameters ?? []) {
    if (parameter.in !== 'path' && parameter.in !== 'query') continue;
    fill(parameter.in, parameter);
  }

  for (const field of endpoint.body ?? []) fill('body', field);

  // The same object when nothing changed, so that an effect watching this cannot
  // ask for another render over an answer it already has.
  return filled ? next : values;
}

/**
 * One editable value: a path, query or body field of the request.
 *
 * A field that names something — a course, a lesson, an organization, a key —
 * gets a list of the real ones beside the box, for the reader who came to try an
 * endpoint without an id in hand. The list is read for the signed-in reader
 * rather than for the key, and only when the menu is opened; `lib/api-choices`
 * is where that decision is argued. Fields that are not ids keep the plain box
 * they always had.
 */
function ValueInput({
  endpointId,
  field,
  value,
  onChange,
  canPick,
  scope,
}: {
  endpointId: string;
  field: ApiField;
  value: string;
  onChange: (next: string) => void;
  /** False when there is nobody signed in to read the lists as. */
  canPick: boolean;
  /** What the rest of this card already says, for a scoped list. */
  scope: ChoiceScope;
}) {
  const id = `${endpointId}-${field.name}`;
  const source = canPick ? field.choices : undefined;

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="font-mono text-xs">
        {field.name}
      </Label>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.example ?? field.type}
          autoComplete="off"
          className={cn('font-mono text-xs', source && 'pr-9')}
        />
        {source && (
          <FieldPicker
            source={source}
            scope={scope}
            value={value}
            onPick={onChange}
            label={`Pick ${field.name} from ${API_CHOICE_TITLES[source]}`}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One endpoint, run for real.
 *
 * The fields are the endpoint's own documented parameters, seeded with the
 * examples printed beside them — which is what makes an untouched Send safe: an
 * example course id is a course that does not exist, so a `POST` nobody edited
 * cannot revoke anything real.
 *
 * Somebody who means to send a request, though, needs a real id, and the
 * reference cannot print one: the ids it does print name records that were never
 * made. That is what the pickers beside the id fields are for — the example is
 * where a value goes, the picker is a real one to put there.
 *
 * A key made for an organization is the one value the page fills in by itself,
 * because it is the one with a single right answer: that key reaches that
 * organization and nothing else, so a card asking for an organization that
 * printed an example id would be offering a 403 it already knew about.
 *
 * What comes back is shown as it arrived. A status is a status, a body is the
 * body, and a request that never left the browser says so in those words rather
 * than being dressed up as an error from the API.
 */
export function TryIt({ endpoint }: { endpoint: ApiEndpoint }) {
  const { credential } = usePlayground();
  const signedIn = useIsSignedIn();
  const [values, setValues] = useState<PlaygroundValues>(() => startingValues(endpoint));
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  /**
   * The organization the key in this tab was made for, when it was made for one.
   *
   * It reaches one organization, so it decides everything the page can be
   * specific about: which organization is filled in where a card asks for one,
   * which course and which lesson, and what the pickers offer — that
   * organization's courses and lessons rather than everything the reader can
   * name. A key that says nothing about an organization — a personal one, or one
   * that has not been asked yet — leaves all of it alone.
   */
  const keyOrganizationId = credential?.kind === 'key' ? credential.organizationId : undefined;
  const keyOrganizationName = credential?.kind === 'key' ? credential.organizationName : undefined;

  /**
   * The organization's first course, and that course's first lesson, read from
   * the API. One query for the whole page: every card wants the same three ids.
   */
  const defaults = useApiKeyDefaults(keyOrganizationId);

  const needsKey = endpoint.auth === 'key';
  const ready = needsKey ? credential?.kind === 'key' : true;
  const changedSomething = endpoint.method !== 'GET';

  const pathParameters = (endpoint.parameters ?? []).filter((p) => p.in === 'path');
  const queryParameters = (endpoint.parameters ?? []).filter((p) => p.in === 'query');
  const bodyFields = endpoint.body ?? [];

  // Follows the key rather than being read once at mount: a key made from the
  // panel above a moment ago has to reach the cards already on the page, and one
  // that is forgotten has to stop being assumed. The seeds arrive in two steps —
  // the organization with the key, the course and the lesson a request later —
  // and the second step replaces the first.
  useEffect(() => {
    setValues((current) => withKeyDefaults(current, endpoint, defaults));
  }, [endpoint, defaults]);

  /**
   * What this card already says, for the pickers whose lists are scoped by
   * another field: a lesson list is a course's lessons, and an organization's
   * keys are that organization's. Read from the values as they stand, so a
   * course typed into this card narrows the lesson field beside it.
   */
  const scope: ChoiceScope = {
    spaceId: values.path.spaceId ?? values.body.spaceId,
    orgId: values.path.orgId ?? values.body.orgId,
    keyOrgId: keyOrganizationId,
    keyOrgName: keyOrganizationName,
  };

  const url = useMemo(() => playgroundUrl(endpoint, values), [endpoint, values]);

  function set(where: keyof PlaygroundValues, name: string, next: string) {
    setValues((current) => ({ ...current, [where]: { ...current[where], [name]: next } }));
  }

  async function send() {
    if (!credential) return;
    setSending(true);
    setResult(null);
    setFailure(null);

    try {
      setResult(await runEndpoint(endpoint, values, credential));
    } catch (err) {
      setFailure(
        err instanceof PlaygroundRequestError
          ? err.message
          : 'Something went wrong before the request could be sent.',
      );
    } finally {
      setSending(false);
    }
  }

  const responseLabel = result
    ? `${result.status} · ${result.ms} ms · application/json`
    : 'Response';
  const hasBody = result !== null && (result.json !== undefined || (result.text ?? '').length > 0);

  return (
    <section className="grid gap-3 rounded-2xl border border-border/60 bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ZapIcon className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-base font-semibold tracking-tight">Try it</h3>
        {!ready && (
          <span className="text-xs text-muted-foreground">
            Needs a key —{' '}
            <a href="#try-it" className="underline underline-offset-4 hover:text-foreground">
              add one above
            </a>
          </span>
        )}
      </div>

      {pathParameters.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {pathParameters.map((field) => (
            <ValueInput
              key={field.name}
              endpointId={endpoint.id}
              field={field}
              value={values.path[field.name] ?? ''}
              onChange={(next) => set('path', field.name, next)}
              canPick={signedIn}
              scope={scope}
            />
          ))}
        </div>
      )}

      {queryParameters.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {queryParameters.map((field) => (
            <ValueInput
              key={field.name}
              endpointId={endpoint.id}
              field={field}
              value={values.query[field.name] ?? ''}
              onChange={(next) => set('query', field.name, next)}
              canPick={signedIn}
              scope={scope}
            />
          ))}
        </div>
      )}

      {bodyFields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {bodyFields.map((field) => (
            <ValueInput
              key={field.name}
              endpointId={endpoint.id}
              field={field}
              value={values.body[field.name] ?? ''}
              onChange={(next) => set('body', field.name, next)}
              canPick={signedIn}
              scope={scope}
            />
          ))}
        </div>
      )}

      <p className="truncate font-mono text-xs text-muted-foreground" title={url}>
        {endpoint.method} {url}
      </p>

      {changedSomething && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          This one changes something, and there is no undo. The values above are the reference’s
          examples, so most untouched sends land on records that do not exist — but read what you
          are sending anyway.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!ready || sending}
          onClick={() => void send()}
        >
          <SendIcon className={cn(sending && 'animate-pulse')} />
          {sending ? 'Sending…' : 'Send request'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // Back to the documented examples, with the key's own answers still
            // filled in: resetting a card should not make it send a value the key
            // cannot reach.
            setValues(withKeyDefaults(startingValues(endpoint), endpoint, defaults));
            setResult(null);
            setFailure(null);
          }}
        >
          <RotateCcwIcon />
          Reset
        </Button>
      </div>

      {failure && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-muted-foreground">
          {failure}
        </p>
      )}

      {result && (
        <div className="grid gap-2">
          {/* A delete answers with a status and nothing else, and an empty code
              block reads as a failed request rather than a finished one. */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 font-mono text-xs font-semibold',
                statusClass(result.status),
              )}
            >
              {result.status}
            </span>
            <span className="text-xs text-muted-foreground">{result.ms} ms</span>
            {isGatewayResponse(result) && (
              <span className="text-xs text-muted-foreground">
                Answered by API Gateway before the endpoint ran — the key was refused.
              </span>
            )}
          </div>
          {hasBody ? (
            <CodeBlock
              label={responseLabel}
              code={result.json !== undefined ? JSON.stringify(result.json, null, 2) : (result.text ?? '')}
              className="bg-background"
            />
          ) : (
            <p className="rounded-2xl border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground">
              No body — the request succeeded and there is nothing to read back.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
