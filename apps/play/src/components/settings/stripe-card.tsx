"use client";

import { ExternalLinkIcon } from "lucide-react";

import { Card, CardHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CopyRow } from "@/components/ui/copy-row";
import type { EnvironmentSettings } from "@/lib/types";

/**
 * The half of taking money that lives in the Stripe dashboard.
 *
 * Three things have to be true before a course can be sold, and two of them are
 * a conversation with Stripe rather than a setting here:
 *
 * 1. **The endpoint exists.** Stripe has to be told where to send an event, and
 *    the URL is a Lambda function URL that only the payment stack can name — a
 *    random subdomain, assigned when the function is created. So it is read off
 *    the deployment and printed beside a copy button, exactly like the two values
 *    Google has to be told.
 * 2. **The endpoint's signing secret comes back.** Stripe shows it once, when the
 *    endpoint is created, and it is what every event is verified with — so it
 *    belongs in the credentials form below, and this card says so rather than
 *    leaving somebody to work out that the two halves are related.
 * 3. **The events are subscribed.** The list below is what the deployed handler
 *    does something about; anything else is answered and ignored, which is
 *    harmless, while subscribing to *none* of these is a payment that never
 *    becomes an enrolment.
 *
 * ## Why it is its own card, above the credentials
 *
 * For the same reason the Google card is: this is the order the work happens in.
 * You create the endpoint in Stripe, Stripe hands you a signing secret, and only
 * then is there anything to paste into the form below. A card that printed the
 * secret's field without the URL it belongs to would have the halves the wrong
 * way round.
 */
export function StripeCard({ stage, settings }: { stage: string; settings: EnvironmentSettings }) {
  const { stripe } = settings;
  const deployed = Boolean(stripe.webhookUrl);

  return (
    <Card>
      <CardHeading
        title="What Stripe has to be told"
        hint={
          deployed
            ? `Add this URL as a webhook endpoint in the Stripe dashboard, subscribe it to the events below, and paste the signing secret it gives you into the credentials. Each environment has its own endpoint and its own keys, so ${stage} cannot spend another environment's money.`
            : `The endpoint is a function URL created by PlayPaymentStack-${stage}, so there is nothing to point Stripe at until the payment stack has been deployed. The credentials below can be set first — the secret key and the publishable key come from the Stripe dashboard and do not depend on this.`
        }
        action={
          <Chip tone={deployed ? "ok" : "warn"} monospace>
            {deployed ? "endpoint ready" : "not deployed"}
          </Chip>
        }
      />

      <div className="mt-5 flex flex-col gap-3">
        {deployed ? (
          <CopyRow label="Endpoint URL" value={stripe.webhookUrl!} labelClassName="w-56" />
        ) : (
          <p className="text-muted-foreground text-xs">
            No webhook URL yet — it appears once <span className="font-mono">{stage}</span> has been
            deployed with its payment stack.
          </p>
        )}

        <div className="flex items-start gap-3">
          <span className="text-muted-foreground w-56 shrink-0 pt-0.5 text-xs">
            Events to subscribe
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {stripe.events.map((event) => (
              <code
                key={event}
                className="border-border/60 bg-background/60 rounded-full border px-2 py-0.5 font-mono text-xs"
              >
                {event}
              </code>
            ))}
          </div>
        </div>
      </div>

      <div className="text-muted-foreground border-border/40 mt-5 flex flex-col gap-2 border-t pt-4 text-xs leading-relaxed">
        <p>
          <span className="text-foreground/80">Two of the three values are secrets.</span> The API
          key and the endpoint's signing secret go to Secrets Manager and are never read back — the
          form below reports whether each is stored, not what it is. The publishable key is not a
          secret: it is served to browsers, and it is shown like any other setting.
        </p>
        <p>
          <span className="text-foreground/80">Rotating a key is two steps.</span> Saving writes the
          new value, and a webhook container that is already warm keeps the old one until it is
          recycled. Deploying the payment stack — or waiting — is the second step, and a payment
          taken in between fails verification rather than being accepted.
        </p>
        <p className="flex items-center gap-1.5">
          <ExternalLinkIcon className="size-3.5 shrink-0" />
          <span>
            Stripe&apos;s own docs:{" "}
            <a
              className="text-foreground/80 underline decoration-dotted underline-offset-2"
              href="https://docs.stripe.com/webhooks"
              target="_blank"
              rel="noreferrer"
            >
              webhooks
            </a>{" "}
            ·{" "}
            <a
              className="text-foreground/80 underline decoration-dotted underline-offset-2"
              href="https://dashboard.stripe.com/apikeys"
              target="_blank"
              rel="noreferrer"
            >
              API keys
            </a>
          </span>
        </p>
      </div>
    </Card>
  );
}
