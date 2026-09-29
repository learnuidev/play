"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRightIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { SettingsForm } from "@/components/settings/settings-form";
import { GoogleCard } from "@/components/settings/google-card";
import { useSettings } from "@/components/settings/use-settings";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip, Dot, type Tone } from "@/components/ui/chip";
import { backendPath } from "@/lib/backends";
import type { EnvironmentSettings, SigningKeyView } from "@/lib/types";

/**
 * The Checklist: everything this environment needs **from a person**.
 *
 * The Deployments tab is the checklist of what the *console* will do — fourteen
 * steps, each with a check. This is the other half, and it is deliberately a tab
 * of its own, because these are the things no step can do for you:
 *
 * - **The config file**, which is what the stacks stand on. A new environment
 *   has none, and saving this tab's form is what writes one.
 * - **The Google credentials** — a client id, a client secret and the URLs
 *   Cognito will accept. This environment's user pool is built with a Google
 *   identity provider, and nothing anywhere can discover those three.
 * - **The mail sender and the two app base URLs**, which are baked into every
 *   handler's environment.
 * - **The CloudFront signing key**, which is the one requirement nobody can
 *   type: it is generated, and the row is a button rather than a field.
 *
 * So the tab both *asks* and *cancels*: a row with a tick is a requirement that
 * is met, and a row without one is a sentence about the missing thing beside the
 * form that supplies it. The form is open by default whenever something is
 * missing — a page that made somebody find the credentials after telling them
 * the credentials were missing would be a page that wasted the hint.
 *
 * The whole tab is one `useSettings` request: the rows and the form's fields are
 * the same answer, and asking twice is how a page ends up disagreeing with
 * itself after a save.
 */
export function ChecklistView({ stage }: { stage: string }) {
  const {
    settings,
    signingKey,
    loading,
    saving,
    saved,
    keyBusy,
    error,
    write,
    keyNote,
    dismissError,
    reload,
    save,
    ensureSigningKey,
  } = useSettings(stage);

  const rows = useMemo(
    () => (settings ? requirements(stage, settings, signingKey) : []),
    [stage, settings, signingKey],
  );
  const ready = rows.filter((row) => row.done).length;

  // The signing key is the one requirement with a button, and which button
  // depends on why the row is unticked: a pair that is not there is created, and
  // a read that failed is retried — creating one because SSM was unreadable
  // would be answering a question nobody asked.
  const keyAction =
    signingKey === null
      ? { label: "Check again", onClick: reload, busy: loading }
      : signingKey.ready
        ? undefined
        : { label: "Create it", onClick: () => void ensureSigningKey(), busy: keyBusy };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeading
          title="What this environment needs"
          hint="The values nothing can discover, and the key material that is generated rather than typed. All of it has to be in place before a deploy can create this environment's pool and distribution."
          action={
            rows.length > 0 ? (
              <Chip tone={ready === rows.length ? "ok" : "warn"} monospace>
                {ready} / {rows.length}
              </Chip>
            ) : null
          }
        />

        {loading && !settings ? (
          <p className="text-muted-foreground mt-4 text-sm">Reading the environment…</p>
        ) : (
          <div className="mt-4 flex flex-col">
            {rows.map((row) => (
              <RequirementRow
                key={row.id}
                row={row}
                action={row.id === "signing-key" ? keyAction : undefined}
              />
            ))}
          </div>
        )}

        {keyNote ? (
          <p className="text-muted-foreground border-border/40 mt-3 border-t pt-3 text-xs leading-relaxed">
            Signing key: <span className="text-foreground/80">{keyNote}</span>
          </p>
        ) : null}
      </Card>

      {error ? (
        <div className="border-destructive/35 bg-destructive/10 text-destructive flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <pre className="flex-1 font-sans whitespace-pre-wrap">{error}</pre>
          <IconButton onClick={dismissError} aria-label="Dismiss">
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
      ) : null}

      {/* Above the credentials, and **outside** the form: these two are outputs
          to copy rather than inputs to fill in, so they must not sit behind the
          collapse that hides the fields once nothing is missing. */}
      {settings ? <GoogleCard stage={stage} settings={settings} /> : null}

      {/* Always open. It used to be collapsed behind an "Edit" button whenever
          the four rows above were all satisfied, on the reasoning that nobody
          needs the client id field on an environment that has one — except that
          "change the callback URLs" and "replace the client secret" are not
          missing requirements, and they are exactly what this form is for. A
          page whose whole subject is the values a person has to supply should
          show them. */}
      {settings ? (
        <SettingsForm
          key={stage}
          stage={stage}
          settings={settings}
          creating={!settings.hasConfig}
          saving={saving}
          saved={saved}
          write={write}
          onSubmit={save}
        />
      ) : null}

      <Card>
        <CardHeading
          title="Then: the deploy"
          hint="What is above is the inputs. What a deploy does with them — write the config file, bootstrap the account, bundle the handlers, deploy the four stacks — is on the Deployments tab, and every step whose check finds its work already done is a check mark rather than a run."
          action={
            <Link
              href={`${backendPath(stage)}?tab=deployments`}
              className="border-border/70 bg-card hover:bg-accent inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors"
            >
              Open the deploy checklist
              <ArrowRightIcon className="size-3.5" />
            </Link>
          }
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The requirements
 * ------------------------------------------------------------------ */

interface Requirement {
  id: "config" | "google" | "mail" | "signing-key";
  title: string;
  label: string;
  note: string;
  tone: Tone;
  done: boolean;
}

/**
 * What is missing, in the order it has to be supplied.
 *
 * The config file comes first because it is what the rest is written *into*; the
 * signing key comes last because it is the only row with a button. Every note
 * names the thing that is absent rather than the state of the row — "no client
 * secret stored" is actionable, "not ready" is not.
 */
function requirements(
  stage: string,
  settings: EnvironmentSettings,
  signingKey: SigningKeyView | null,
): Requirement[] {
  const google = googleGaps(settings);
  const mail = mailGaps(settings);

  return [
    {
      id: "config",
      title: "The config file",
      done: settings.hasConfig,
      tone: settings.hasConfig ? "ok" : "warn",
      label: settings.hasConfig ? "written" : "not written",
      note: settings.hasConfig
        ? `${settings.configPath} — a new environment: its own tables, videos bucket, distribution and user pool.`
        : `Nothing on disk yet: saving the credentials below writes ${settings.configPath} as a new environment, which creates its own tables, bucket, distribution and pool.${
            settings.seededFrom
              ? ` The product's own values start from play-${settings.seededFrom}.json — no other environment's data is copied.`
              : ""
          }`,
    },
    {
      id: "google",
      title: "Google sign-in",
      done: google.length === 0,
      tone: google.length === 0 ? "ok" : "warn",
      label: google.length === 0 ? "provided" : "needs you",
      note:
        google.length === 0
          ? [
              settings.auth.googleClientId,
              // An imported pool already has its provider attached, so no
              // deploy reads a secret and its absence is not a requirement.
              settings.needsGoogleSecret
                ? `secret stored at ${settings.googleClientSecretName}`
                : "the pool is imported, so a deploy reads no secret",
              `${settings.auth.callbackUrls.length} callback URL${
                settings.auth.callbackUrls.length === 1 ? "" : "s"
              }`,
            ].join(" · ")
          : `This environment creates its own user pool, and the pool is built with a Google identity provider — so ${
              google.join(", ")
            }. The console cannot look these up, and a deploy without them stops at the step that provisions the secret.`,
    },
    {
      id: "mail",
      title: "Mail and origins",
      done: mail.length === 0,
      tone: mail.length === 0 ? "ok" : "warn",
      label: mail.length === 0 ? "set" : "needs you",
      note:
        mail.length === 0
          ? `${settings.mail.fromAddress} · ${settings.mail.appBaseUrl} · ${settings.mail.marketplaceBaseUrl}`
          : `The invitation sender and the two app base URLs are baked into every handler's environment, and ${mail.join(", ")}.`,
    },
    {
      id: "signing-key",
      title: "The CloudFront signing key",
      done: signingKey?.ready ?? false,
      tone: signingKey === null ? "muted" : signingKey.ready ? "ok" : "warn",
      label: signingKey === null ? "unknown" : signingKey.ready ? "in SSM" : "not in SSM",
      note: keyNote(stage, signingKey),
    },
  ];
}

/**
 * The signing key, in a sentence.
 *
 * Four states, and the difference between them is *which half is read*: a stage
 * that creates its distribution is built from the public parameter, so both
 * halves are needed; a stage that imports one has its public side already (the
 * key group that distribution has) and only ever signs with the private half.
 * Saying "both halves must be in SSM" to `dev` would be asking for a parameter
 * nothing reads.
 */
function keyNote(stage: string, key: SigningKeyView | null): string {
  if (key === null) {
    return "SSM could not be read, so whether the key pair is there is not known — the console's AWS credentials are the usual reason.";
  }

  const shared = key.own
    ? ""
    : " Its config names the shared pair rather than its own — which is what a stage that imports the distribution that pair gates has to do.";

  if (key.importedMedia) {
    return key.ready
      ? `${key.privateParam} holds the private half; the public side is the key group the distribution this environment imports already has.${shared}`
      : `${key.privateParam} is not in SSM, and this environment imports the distribution it signs for — the pair has to be the one that distribution was created against, so nothing here can generate it.`;
  }

  if (key.ready) {
    return `${key.privateParam} holds the private half; ${key.publicParam} holds the public half the distribution is created against.${shared}`;
  }

  const missing = !key.privateExists
    ? key.publicExists
      ? `${key.privateParam} is not in SSM`
      : `Neither half is in SSM: ${key.privateParam} and ${key.publicParam}`
    : `${key.publicParam} is not in SSM`;
  return `${missing}, so a distribution this environment creates would have a key group with no key in it. The pair is generated on demand and never rotated — an existing one is left exactly as it is, and a new environment's pair is named after the stage: \`/play/${stage}/cloudfront/*\`.`;
}

/** The Google values that are missing, named one at a time. */
function googleGaps(settings: EnvironmentSettings): string[] {
  const gaps: string[] = [];
  if (!settings.auth.googleClientId) gaps.push("no client id");
  if (settings.needsGoogleSecret && !settings.googleClientSecretSet) gaps.push("no client secret stored");
  if (settings.auth.callbackUrls.length === 0) gaps.push("no callback URLs");
  if (settings.auth.logoutUrls.length === 0) gaps.push("no logout URLs");
  return gaps;
}

/** The mail values that are missing. */
function mailGaps(settings: EnvironmentSettings): string[] {
  const gaps: string[] = [];
  if (!settings.mail.fromAddress) gaps.push("the from address is empty");
  if (!settings.mail.appBaseUrl) gaps.push("the studio base URL is empty");
  if (!settings.mail.marketplaceBaseUrl) gaps.push("the marketplace base URL is empty");
  return gaps;
}

/* ------------------------------------------------------------------ *
 * One row
 * ------------------------------------------------------------------ */

function RequirementRow({
  row,
  action,
}: {
  row: Requirement;
  /** Supplied by the page: a row asks for something, and only one row can do it in place. */
  action?: { label: string; onClick: () => void; busy: boolean };
}) {
  return (
    <div className="border-border/40 flex flex-wrap items-start gap-3 border-t py-3 first:border-t-0">
      <Dot tone={row.tone} className="mt-2" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.title}</span>
          <Chip tone={row.tone}>{row.label}</Chip>
        </div>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{row.note}</p>
      </div>

      {action ? (
        <Button size="sm" variant="secondary" busy={action.busy} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
