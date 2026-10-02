'use client';

import { useEffect, useMemo, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Loader2Icon, LockIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useSavePaymentMethod, useStartPaymentMethodSetup } from '@play/api';
import { billingDetailsOf } from '@/lib/billing-address';
import { useElementsAppearance } from '@/lib/stripe-appearance';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ui/components/ui/dialog';

/**
 * Adding a card, in a form this app draws.
 *
 * ## Why Elements and not Stripe's hosted page
 *
 * The number is still typed into a Stripe-owned field — that is what Elements
 * is, and it is why nothing here is PCI scope: the value never touches this
 * app's DOM, only Stripe's iframe. What changes is who chooses the *fields*. The
 * hosted page offered every method the account has configured, and Stripe Link
 * was one of them: the card then saved as a `link` payment method with no brand
 * and no last four digits, which is not a row this product can draw. A form that
 * collects a card collects a card.
 *
 * ## The two steps, and why the second one matters
 *
 * "Add a card" asks the API for a **setup intent** and the publishable key, and
 * only then loads Stripe.js — so no page in this app pays for Stripe's script
 * unless somebody is about to save a card. Confirming happens in the browser,
 * and the id comes back to the API, which reads the intent from Stripe before
 * writing anything. The card is therefore in the wallet the moment it is saved,
 * with no webhook to wait for.
 */
export function AddCardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mutateAsync: startSetup } = useStartPaymentMethodSetup();
  /**
   * How the field is drawn — the theme the page is in, and no accent.
   *
   * A saved card belongs to the account rather than to a course, so there is no
   * brand colour to pass: the form is the product's, and the shared appearance
   * is what keeps it the same form as the checkout's. See
   * `lib/stripe-appearance`.
   */
  const appearance = useElementsAppearance();

  const [session, setSession] = useState<{
    clientSecret: string;
    stripe: Promise<Stripe | null>;
    /** The address this account was last set to, for the Element to open on. */
    billingDetails: ReturnType<typeof billingDetailsOf>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by "Try again", and the only reason this effect ever runs twice. */
  const [attempt, setAttempt] = useState(0);

  /**
   * Opening the dialog *is* asking for the form.
   *
   * The intent used to be fetched behind a Start button inside the dialog, and
   * that button was a step that existed only to be clicked: the person had
   * already said what they wanted by pressing "Add a card", and the answer they
   * were waiting for was a card field. So the intent is asked for here, when the
   * dialog opens, and what they see is a form — or the sentence saying why there
   * is not one.
   *
   * A client secret is fetched per opening rather than with the page, because it
   * belongs to one attempt: minted on a page load it would expire while somebody
   * read the sentence above it.
   */
  useEffect(() => {
    if (!open) {
      setSession(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const intent = await startSetup();
        if (cancelled) return;
        setSession({
          clientSecret: intent.clientSecret,
          stripe: loadStripe(intent.publishableKey),
          billingDetails: billingDetailsOf(intent.billingAddress),
        });
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not open the card form');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, attempt, startSetup]);

  /**
   * Stripe.js is loaded once per publishable key.
   *
   * `loadStripe` is memoised by Stripe's own module on the key, so calling it
   * again for the same deployment costs nothing — but the *promise* is held here
   * too, because an `Elements` provider given a new promise on every render
   * remounts its children, and a card form that remounts clears itself.
   */
  const stripePromise = useMemo(() => session?.stripe ?? null, [session]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a card</DialogTitle>
          <DialogDescription>
            Saved with Stripe, our payment provider. We keep the brand and the last four digits so
            you can tell your cards apart.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="grid gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        ) : !session ? (
          <p className="inline-flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Opening the card form…
          </p>
        ) : (
          <Elements stripe={stripePromise} options={{ clientSecret: session.clientSecret, appearance }}>
            <CardForm
              clientSecret={session.clientSecret}
              billingDetails={session.billingDetails}
              onSaved={() => onOpenChange(false)}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The card field and the button that saves it.
 *
 * `confirmSetup` never leaves the page: `redirect: 'if_required'` is what makes
 * that true for a card that needs no 3-D Secure step, and a card that does need
 * one is sent to Stripe and back — which is Stripe's business rather than a
 * screen this app has to draw.
 */
function CardForm({
  clientSecret,
  billingDetails,
  onSaved,
}: {
  clientSecret: string;
  /** The address this account was last set to, or undefined if never given. */
  billingDetails: ReturnType<typeof billingDetailsOf>;
  onSaved: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const save = useSavePaymentMethod();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Confirm, then record — the two halves of saving a card.
   *
   * Three steps, in this order, and the order is Stripe's: `elements.submit()`
   * validates what is in the Element and hands it over, `confirmSetup` confirms
   * it, and the API records the result. `redirect: 'if_required'` is what keeps
   * the confirmation on this page for a card that needs no 3-D Secure step, and
   * a card that does need one is sent to Stripe and back, which is Stripe's
   * business rather than a screen this app draws.
   *
   * The **country is required** and Stripe enforces it: a billing address with no
   * country is refused before the intent is confirmed, which is the "ask me to
   * select one" half of it. What the person chooses is then written onto their
   * account by the API, so the next form opens on it.
   */
  async function submit() {
    if (!stripe || !elements) return;

    setBusy(true);
    setError(null);

    /**
     * **`elements.submit()` first, and before anything asynchronous.**
     *
     * The Payment Element is a *deferred* integration: the fields live in
     * Stripe's iframe, nothing is sent anywhere while somebody types, and the
     * confirmation is refused outright until the Element has been told to
     * validate and hand its data over. Calling `confirmSetup` without it is an
     * `IntegrationError` rather than a failed card, which is what this did
     * before.
     *
     * It is also where an incomplete billing address is caught: no country, or a
     * postal code that does not fit the country chosen, comes back here as a
     * sentence next to the form instead of as a card that never saves.
     */
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? 'Check the card details and try again.');
      setBusy(false);
      return;
    }

    const result = await stripe.confirmSetup({
      elements,
      clientSecret,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (result.error) {
      setError(result.error.message ?? 'That card could not be saved.');
      setBusy(false);
      return;
    }

    const intent = result.setupIntent;
    if (!intent || intent.status !== 'succeeded') {
      setError('Stripe did not confirm the card. Try again.');
      setBusy(false);
      return;
    }

    try {
      await save.mutateAsync({ setupIntentId: intent.id });
      toast.success('Card saved');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that card.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {/* **A Payment Element, not a Card Element**, and the difference is the
          country. The card field drew a postal code and nothing else — a bare
          `12345` box, which is a United States address and no other kind — and
          there was no way to say otherwise, because that Element has no country
          in it at all.

          This one collects the billing address: a country first, and then the
          postal code that country actually has, checked against it.

          **It opens on the whole address, not on the country alone.** This form
          used to be given a country and nothing else, so somebody who had already
          said where they live was shown their country filled in above an empty
          postal code — the form asking for the same details twice, which is what
          fixing this looked like from the outside. What it is given now is
          whatever Stripe collected last time, written onto the customer by the
          route that saves a card and by the webhook when somebody pays. With
          nothing remembered it starts empty, and Stripe refuses to confirm the
          card until it is filled in. */}
      <PaymentElement options={{ defaultValues: { billingDetails } }} />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockIcon className="size-3.5" />
          The number goes to Stripe, never to us.
        </p>
        <Button className="ml-auto" onClick={() => void submit()} disabled={busy || !stripe}>
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          {busy ? 'Saving…' : 'Save card'}
        </Button>
      </div>
    </div>
  );
}
