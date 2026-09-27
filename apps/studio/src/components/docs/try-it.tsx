'use client';

import { useMemo, useState } from 'react';
import { RotateCcwIcon, SendIcon, TriangleAlertIcon, ZapIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { cn } from '@ui/lib/utils';
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

/** One editable value: a path, query or body field of the request. */
function ValueInput({
  endpointId,
  field,
  value,
  onChange,
}: {
  endpointId: string;
  field: ApiField;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = `${endpointId}-${field.name}`;

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="font-mono text-xs">
        {field.name}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.example ?? field.type}
        autoComplete="off"
        className="font-mono text-xs"
      />
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
 * What comes back is shown as it arrived. A status is a status, a body is the
 * body, and a request that never left the browser says so in those words rather
 * than being dressed up as an error from the API.
 */
export function TryIt({ endpoint }: { endpoint: ApiEndpoint }) {
  const { credential } = usePlayground();
  const [values, setValues] = useState<PlaygroundValues>(() => startingValues(endpoint));
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const needsKey = endpoint.auth === 'key';
  const ready = needsKey ? credential?.kind === 'key' : true;
  const changedSomething = endpoint.method !== 'GET';

  const pathParameters = (endpoint.parameters ?? []).filter((p) => p.in === 'path');
  const queryParameters = (endpoint.parameters ?? []).filter((p) => p.in === 'query');
  const bodyFields = endpoint.body ?? [];

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
            setValues(startingValues(endpoint));
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
          <CodeBlock
            label={responseLabel}
            code={
              result.json !== undefined
                ? JSON.stringify(result.json, null, 2)
                : (result.text ?? '')
            }
            className="bg-background"
          />
        </div>
      )}
    </section>
  );
}
