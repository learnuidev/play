"use client";

import { Card, CardHeading } from "@/components/ui/card";
import { CopyRow } from "@/components/ui/copy-row";
import type { EnvironmentSettings } from "@/lib/types";

/**
 * The half of a federated sign-in that lives in the Google Cloud console.
 *
 * Two values, and neither is editable here: the origin and the
 * `/oauth2/idpresponse` path belong to Cognito, and the domain is fixed when a
 * pool is created. They are *outputs* — read off the deployment — so this card
 * has no fields, no save button and nothing to get wrong. What it has is two
 * copy buttons.
 *
 * ## Why it is not inside the credentials form
 *
 * Because it was, and that was the bug. The credentials form collapses to a
 * single "Edit" card once nothing is missing, which is right for inputs — nobody
 * needs the client id field open on an environment that has one. But these two
 * are not inputs, so collapsing them hid the only thing on this page that is
 * meant to be *copied*: the environment was reported healthy and the values you
 * came for were behind a button that says nothing about them.
 *
 * It is the **first** card on the Checklist tab, because it is first in the
 * workflow: you register the OAuth client in Google, Google asks for these two,
 * and only then does it hand back the client id and secret the form below wants.
 */
export function GoogleCard({
  stage,
  settings,
}: {
  stage: string;
  settings: EnvironmentSettings;
}) {
  const { oauth } = settings;
  const ready = Boolean(oauth.javaScriptOrigin && oauth.redirectUri);

  return (
    <Card>
      <CardHeading
        title="What Google has to be told"
        hint={
          settings.needsGoogleSecret
            ? `Register an OAuth client in the Google Cloud console, paste both values below into it, then paste the client id and secret Google gives you into the credentials below. This environment creates its own user pool, so these are the origins Google must recognise.`
            : `These are the values ${stage}'s pool already answers on. They are read off the deployment rather than editable — the origin and the /oauth2/idpresponse path belong to Cognito.`
        }
      />

      <div className="mt-5 flex flex-col gap-3">
        {ready ? (
          <>
            <CopyRow
              label="Authorized JavaScript origins"
              value={oauth.javaScriptOrigin!}
              labelClassName="w-56"
            />
            <CopyRow
              label="Authorized redirect URIs"
              value={oauth.redirectUri!}
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
          the credentials say where <span className="text-foreground/80">Cognito</span> may send them
          afterwards. Google returns to Cognito, Cognito returns to your app — missing either one
          fails sign-in, and this one fails as a{" "}
          <span className="font-mono">redirect_uri_mismatch</span> page that names nothing in this
          repository.
        </p>
      </div>
    </Card>
  );
}
