"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import type {
  EnvironmentSettings,
  EnvironmentSettingsInput,
  SettingsWriteView,
} from "@/lib/types";

/**
 * The credentials form: what an environment is *configured* with, as opposed to
 * what is discovered about it.
 *
 * A new environment creates its own user pool, and a pool is built with a Google
 * OAuth client before it can be deployed — the client id, the secret and the
 * URLs Cognito will accept. Nothing can look those up, so somebody has to supply
 * them, and this is where.
 *
 * The values land in `infra/config/play-<stage>.json` (`auth` and `mail`), which
 * is committed and readable — and the two URL lists land on the live app client
 * as well, because a stage that imports its pool has no deploy that could apply
 * them. **The client secret does not.** It is write-only: sent to Secrets
 * Manager and never read back, because CloudFormation refuses an SSM Secure
 * reference in the identity provider, and the repository is not a place for a
 * credential.
 *
 * The form holds no state of its own beyond its fields — the page that draws it
 * owns the request, because the same response is also the answer to "can this
 * environment deploy yet", and two copies of that answer is one too many.
 *
 * `creating` is the difference between editing an environment's settings and
 * writing the first file of one: there is nothing on disk to compare against, so
 * the button is always available and it says what it will do.
 */

export function SettingsForm({
  stage,
  settings,
  creating,
  saving,
  saved,
  write,
  onSubmit,
}: {
  stage: string;
  settings: EnvironmentSettings;
  /** No config file yet: this save is the one that writes it. */
  creating: boolean;
  saving: boolean;
  saved: boolean;
  /** What the last save wrote, so the line beside the button can say it exactly. */
  write: SettingsWriteView | null;
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
      <Card>
        <CardHeading
          title="Google sign-in"
          hint={
            settings.needsGoogleSecret
              ? `This environment creates its own user pool (play-users-${stage}), so its identity provider is built from these values at deploy — and once that pool exists, saving writes the two URL lists onto its client as well.`
              : `${stage} imports its user pool, so no deploy can change what it accepts — saving writes the two URL lists to Cognito directly, by running set-auth-urls.mjs against this stage's own lists.`
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
        {/* Nothing to compare a first save against: there is no file, so the
            button is always available and it says what it is about to do. */}
        <Button
          type="submit"
          variant="primary"
          busy={saving}
          disabled={!creating && !dirty && !googleClientSecret}
        >
          {creating ? `Create ${stage}'s config` : dirty || googleClientSecret ? "Save settings" : "Saved"}
        </Button>

        {showSaved && write ? (
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <CheckIcon className="text-ok size-3.5" />
              {write.created ? "Created" : "Written to"}{" "}
              <span className="font-mono">infra/config/play-{stage}.json</span>
            </span>
            <span className="text-border">·</span>
            <span>
              {write.secretWritten
                ? `secret stored at ${settings.googleClientSecretName}`
                : "the stored secret was left alone"}
            </span>
            {write.signingKeyNote ? (
              <>
                <span className="text-border">·</span>
                <span>
                  signing key: <span className="text-foreground/80">{write.signingKeyNote}</span>
                </span>
              </>
            ) : null}
            {/* The one part of a save that reaches something running, so it is
                drawn with its own icon: a check when Cognito now holds these
                lists, a warning when it does not — which is a stage whose pool
                does not exist yet as often as it is a failure. */}
            <span className="text-border">·</span>
            <span className="flex items-start gap-1.5">
              {write.authUrls.applied ? (
                <CheckIcon className="text-ok mt-0.5 size-3.5 shrink-0" />
              ) : (
                <TriangleAlertIcon className="text-warn mt-0.5 size-3.5 shrink-0" />
              )}
              <span className={write.authUrls.applied ? undefined : "text-foreground/80"}>
                {write.authUrls.note}
              </span>
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground font-mono text-xs">
            {creating
              ? `nothing is deployed — this writes play-${stage}.json as a new environment`
              : `infra/config/play-${stage}.json`}
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
