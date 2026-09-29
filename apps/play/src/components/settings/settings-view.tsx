"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, KeyRoundIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { useShell } from "@/components/console/state";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CopyRow } from "@/components/ui/copy-row";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import type { EnvironmentSettingsInput } from "@/lib/types";
import { useSettings } from "./use-settings";

/**
 * What an environment is *configured* with, as opposed to what it is discovered
 * to be.
 *
 * A new environment creates its own user pool, and a pool needs a Google OAuth
 * client before it can be deployed — the credentials cannot be discovered from
 * anywhere, so somebody has to supply them. This is where.
 *
 * The values land in `infra/config/play-<stage>.json` (`auth` and `mail`), which
 * is committed and readable. **The client secret does not.** It is write-only:
 * sent to Secrets Manager and never read back, because CloudFormation refuses an
 * SSM Secure reference in the identity provider and the repository is not a
 * place for a credential.
 *
 * Everything here is editable at any time, not only during a first deploy. What
 * changes afterwards depends on the pool:
 *
 * - On an environment that **creates** its pool — a new one — the next deploy
 *   applies whatever is saved here.
 * - On `dev`, whose pool is imported, nothing here reaches Cognito: the live
 *   pool is changed by `services/api/scripts/set-auth-urls.mjs`, and these values
 *   are the record of what it should be.
 */

export function SettingsView() {
  const { stage } = useShell();
  const { settings, loading, saving, error, saved, dismissError, save } = useSettings(stage);

  // The form is a copy of the server's answer, so it can be edited without a
  // round trip; `key` on the form below resets it when the stage changes.
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            What <span className="font-mono">{stage}</span> is configured with — the values that
            cannot be discovered from AWS.
          </p>
        </div>
        {settings?.needsGoogleSecret ? (
          <Chip tone={settings.googleClientSecretSet ? "ok" : "warn"}>
            {settings.googleClientSecretSet ? "Google credentials set" : "Google credentials needed"}
          </Chip>
        ) : null}
      </header>

      {error ? (
        <div className="border-destructive/35 bg-destructive/10 text-destructive flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <pre className="flex-1 font-sans whitespace-pre-wrap">{error}</pre>
          <IconButton onClick={dismissError} aria-label="Dismiss">
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
      ) : null}

      {loading && !settings ? (
        <Card>
          <p className="text-muted-foreground text-sm">Reading the environment&rsquo;s config…</p>
        </Card>
      ) : settings ? (
        <SettingsForm
          key={stage}
          stage={stage}
          settings={settings}
          saving={saving}
          saved={saved}
          onSubmit={save}
        />
      ) : (
        <Card>
          <CardHeading
            title="No config file yet"
            hint={`Deploy ${stage} once — its third step writes infra/config/play-${stage}.json — and these settings become editable.`}
          />
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The form
 * ------------------------------------------------------------------ */

function SettingsForm({
  stage,
  settings,
  saving,
  saved,
  onSubmit,
}: {
  stage: string;
  settings: NonNullable<ReturnType<typeof useSettings>["settings"]>;
  saving: boolean;
  saved: boolean;
  onSubmit: (input: EnvironmentSettingsInput) => Promise<boolean>;
}) {
  const [googleClientId, setGoogleClientId] = useState(settings.auth.googleClientId);
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [callbackUrls, setCallbackUrls] = useState(settings.auth.callbackUrls.join("\n"));
  const [logoutUrls, setLogoutUrls] = useState(settings.auth.logoutUrls.join("\n"));
  const [fromAddress, setFromAddress] = useState(settings.mail.fromAddress);
  const [appBaseUrl, setAppBaseUrl] = useState(settings.mail.appBaseUrl);
  const [marketplaceBaseUrl, setMarketplaceBaseUrl] = useState(settings.mail.marketplaceBaseUrl);

  const draft = useMemo<EnvironmentSettingsInput>(
    () => ({
      auth: {
        googleClientId,
        callbackUrls: lines(callbackUrls),
        logoutUrls: lines(logoutUrls),
      },
      mail: { fromAddress, appBaseUrl, marketplaceBaseUrl },
    }),
    [googleClientId, callbackUrls, logoutUrls, fromAddress, appBaseUrl, marketplaceBaseUrl],
  );

  // The secret is not part of the comparison: the field is empty unless somebody
  // is replacing it, so an empty field is "leave it alone" rather than a change.
  const initial = useMemo(
    () =>
      JSON.stringify({
        auth: settings.auth,
        mail: settings.mail,
      }),
    [settings],
  );
  const dirty = JSON.stringify({ auth: draft.auth, mail: draft.mail }) !== initial;

  // A saved confirmation is about the values that were saved; typing again makes
  // it stale, so it goes.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (saved) setShowSaved(true);
  }, [saved]);
  useEffect(() => {
    if (dirty || googleClientSecret) setShowSaved(false);
  }, [dirty, googleClientSecret]);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(
          googleClientSecret ? { ...draft, googleClientSecret } : draft,
        ).then((ok) => {
          if (ok) setGoogleClientSecret("");
        });
      }}
    >
      {/* First, because it is first in the workflow: you register the OAuth
          client in Google, Google asks for these two, and only then does it hand
          back the client id and secret the next card wants. */}
      <Card>
        <CardHeading
          title="What Google has to be told"
          hint={
            settings.needsGoogleSecret
              ? `Register an OAuth client in the Google Cloud console, paste both values below into it, then paste the client id and secret Google gives you into the next card. This environment creates its own user pool, so these are the origins Google must recognise.`
              : `These are the values ${stage}'s pool already answers on. They are read off the deployment rather than editable — the origin and the /oauth2/idpresponse path belong to Cognito.`
          }
        />

        <div className="mt-5 flex flex-col gap-3">
          {settings.oauth.javaScriptOrigin && settings.oauth.redirectUri ? (
            <>
              <CopyRow
                label="Authorized JavaScript origins"
                value={settings.oauth.javaScriptOrigin}
                labelClassName="w-56"
              />
              <CopyRow
                label="Authorized redirect URIs"
                value={settings.oauth.redirectUri}
                labelClassName="w-56"
              />
            </>
          ) : (
            <p className="text-muted-foreground text-xs">
              No Cognito domain yet — it is created with the user pool, so this appears once{" "}
              <span className="font-mono">{stage}</span> has been deployed. Until then these are the
              two fields to fill in on the Google OAuth client.
            </p>
          )}
        </div>

        <div className="text-muted-foreground mt-5 flex flex-col gap-2 border-t border-border/40 pt-4 text-xs leading-relaxed">
          <p>
            <span className="text-foreground/80">Two lists, both required.</span> These two say where{" "}
            <span className="text-foreground/80">Google</span> may send somebody; the callback URLs in
            the next card say where <span className="text-foreground/80">Cognito</span> may send them
            afterwards. Google returns to Cognito, Cognito returns to your app — missing either one
            fails sign-in, and this one fails as a{" "}
            <span className="font-mono">redirect_uri_mismatch</span> page that names nothing in this
            repository.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeading
          title="Google sign-in"
          hint={
            settings.needsGoogleSecret
              ? `This environment creates its own user pool (play-users-${stage}), so its identity provider is built from these values at deploy.`
              : `${stage} imports its user pool, so nothing here reaches Cognito — the live pool is changed by set-auth-urls.mjs. These are the values a deploy would use if it ever created one.`
          }
          action={
            <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 font-mono text-xs">
              <KeyRoundIcon className="size-3.5" />
              {settings.googleClientSecretSet ? "secret stored" : "no secret"}
            </span>
          }
        />

        <div className="mt-5 flex flex-col gap-5">
          <Field
            label="Client id"
            htmlFor="google-client-id"
            hint="The OAuth 2.0 client id from the Google Cloud console — it ends in .apps.googleusercontent.com."
          >
            <TextInput
              id="google-client-id"
              value={googleClientId}
              onChange={(event) => setGoogleClientId(event.target.value)}
              placeholder="344458249806-xxxxxxxxxxxxxxxx.apps.googleusercontent.com"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>

          <Field
            label="Client secret"
            htmlFor="google-client-secret"
            hint={
              settings.googleClientSecretSet
                ? "A secret is already stored. It is never shown again — type a new one only to replace it."
                : `Write-only, and stored in Secrets Manager as ${settings.googleClientSecretName}. It is never written to the repository.`
            }
          >
            <TextInput
              id="google-client-secret"
              type="password"
              value={googleClientSecret}
              onChange={(event) => setGoogleClientSecret(event.target.value)}
              placeholder={settings.googleClientSecretSet ? "•••••••• (unchanged)" : "GOCSPX-…"}
              spellCheck={false}
              autoComplete="new-password"
            />
          </Field>

          <Field
            label="Callback URLs"
            htmlFor="callback-urls"
            hint="One per line. Cognito accepts https, and http on localhost. These are the origins allowed to receive the authorization code."
          >
            <TextArea
              id="callback-urls"
              rows={5}
              value={callbackUrls}
              onChange={(event) => setCallbackUrls(event.target.value)}
              placeholder={"http://localhost:3000\nhttp://localhost:3000/auth/callback"}
              spellCheck={false}
            />
          </Field>

          <Field
            label="Logout URLs"
            htmlFor="logout-urls"
            hint="One per line. Where Cognito is allowed to send somebody after signing out."
          >
            <TextArea
              id="logout-urls"
              rows={3}
              value={logoutUrls}
              onChange={(event) => setLogoutUrls(event.target.value)}
              placeholder={"http://localhost:3000"}
              spellCheck={false}
            />
          </Field>

          <p className="text-muted-foreground text-xs leading-relaxed">
            The same URLs have to be listed on the Google OAuth client as authorised redirect URIs.
            Cognito redirects to <span className="font-mono">/oauth2/idpresponse</span> on{" "}
            <span className="font-mono">
              {settings.needsGoogleSecret
                ? `play-${stage}-<account>.auth.<region>.amazoncognito.com`
                : "the pool's domain"}
            </span>
            , and Google has to allow that origin too.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeading
          title="Mail and origins"
          hint="The sender invitations come from, and the two app base URLs baked into every handler's environment."
        />

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="From address" htmlFor="mail-from">
            <TextInput
              id="mail-from"
              type="email"
              value={fromAddress}
              onChange={(event) => setFromAddress(event.target.value)}
              placeholder="learnuidev@gmail.com"
              spellCheck={false}
            />
          </Field>
          <Field label="Studio base URL" htmlFor="mail-studio">
            <TextInput
              id="mail-studio"
              value={appBaseUrl}
              onChange={(event) => setAppBaseUrl(event.target.value)}
              placeholder="http://localhost:3000"
              spellCheck={false}
            />
          </Field>
          <Field label="Marketplace base URL" htmlFor="mail-marketplace">
            <TextInput
              id="mail-marketplace"
              value={marketplaceBaseUrl}
              onChange={(event) => setMarketplaceBaseUrl(event.target.value)}
              placeholder="http://localhost:3001"
              spellCheck={false}
            />
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" busy={saving} disabled={!dirty && !googleClientSecret}>
          {dirty || googleClientSecret ? "Save settings" : "Saved"}
        </Button>

        {showSaved ? (
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <CheckIcon className="text-ok size-3.5" />
            Written to{" "}
            <span className="font-mono">
              infra/config/play-{stage}.json
            </span>
            {googleClientSecret ? "" : " — the stored secret was left alone"}
          </span>
        ) : (
          <span className="text-muted-foreground font-mono text-xs">
            infra/config/play-{stage}.json
          </span>
        )}
      </div>
    </form>
  );
}

/** A textarea of URLs, one per line, as the array the config holds. */
function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
