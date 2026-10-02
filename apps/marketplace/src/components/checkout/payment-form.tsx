'use client';

import { useMemo, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { Loader2Icon, LockIcon } from 'lucide-react';
import { Button, formatPrice } from '@play/ui';
import type { CourseCheckoutResponse } from '@play/types';
import { useElementsAppearance } from '@/lib/stripe-appearance';

/**
 * Paying for a course, in a form this app draws.
 *
 * ## What is Stripe's here and what is not
 *
 * The card number is typed into a Stripe-owned field: that is what Elements is,
 * and it is why this page is not PCI scope — the value lives in Stripe's iframe
 * and never reaches this app's DOM. Everything around it is this product's: the
 * summary beside it, the button under it, and the colour the Element draws in,
 * which is the course's own.
 *
 * ## The intent was opened by the page, and handed over
 *
 * `session` is what `POST /spaces/{id}/checkout` answered with when the page
 * opened: a client secret for a payment intent that exists, with the course, the
 * buyer and the amount already on it. So there is nothing to send to this app's
 * own API at the end — the money is Stripe's news, and it is delivered to the
 * webhook, which is what writes the membership.
 */
export function CheckoutPaymentForm({
  session,
  accent,
  onPaid,
}: {
  session: CourseCheckoutResponse;
  /** The course's colour, which the Element draws its own buttons in. */
  accent: string;
  /** Called once the payment has been confirmed, or sent away to be confirmed. */
  onPaid: () => void;
}) {
  const appearance = useElementsAppearance(accent);

  /**
   * Stripe.js is loaded once per publishable key.
   *
   * `loadStripe` is memoised by Stripe's own module on the key, so calling it
   * again for the same deployment costs nothing — but the *promise* is held here
   * too, because an `Elements` provider given a new promise on every render
   * remounts its children, and a payment form that remounts clears itself.
   */
  const stripe = useMemo(() => loadStripe(session.publishableKey), [session.publishableKey]);

  return (
    <Elements stripe={stripe} options={{ clientSecret: session.clientSecret, appearance }}>
      <PaymentFields session={session} onPaid={onPaid} />
    </Elements>
  );
}

/** The Element, and the button that confirms it. */
function PaymentFields({
  session,
  onPaid,
}: {
  session: CourseCheckoutResponse;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Confirm, and let the webhook do the rest.
   *
   * Four steps in Stripe's order. `elements.submit()` validates what is in the
   * Element and hands it over — the Payment Element is a *deferred* integration,
   * so nothing is sent anywhere while somebody types, and `confirmPayment` is
   * refused outright until the Element has been told to validate. Then the
   * confirmation itself, which stays on this page for a card that needs no
   * verification step: `redirect: 'if_required'` is what makes that true, and a
   * payment that does need one — a bank's own page, or a wallet that leaves the
   * site — is sent to Stripe and comes back to the course page, which is what
   * `returnUrl` is.
   *
   * A failure is shown as Stripe's own sentence, which names the field: a
   * declined card says so, and a postal code that does not fit the country says
   * that. Then the reader is sent — by the page above, not from here — to the
   * course, where the panel waits for an enrolment it cannot see yet. **This is
   * the one thing that is not Stripe's**: `confirmPayment` resolving is not the
   * same fact as the webhook having arrived.
   */
  async function pay() {
    if (!stripe || !elements) return;

    setBusy(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? 'Check the payment details and try again.');
      setBusy(false);
      return;
    }

    const result = await stripe.confirmPayment({
      elements,
      clientSecret: session.clientSecret,
      confirmParams: { return_url: session.returnUrl },
      redirect: 'if_required',
    });

    if (result.error) {
      setError(result.error.message ?? 'That payment did not go through.');
      setBusy(false);
      return;
    }

    onPaid();
  }

  return (
    <div className="grid gap-4">
      <PaymentElement />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button className="w-full gap-1.5" onClick={() => void pay()} disabled={busy || !stripe}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        {busy ? 'Paying…' : `Pay ${formatPrice(session.amountCents, session.currency)}`}
      </Button>

      <p className="inline-flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" />
        The number goes to Stripe, never to us. Your access appears the moment the payment is
        confirmed.
      </p>
    </div>
  );
}
