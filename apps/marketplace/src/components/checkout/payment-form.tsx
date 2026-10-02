'use client';

import { useMemo, useState } from 'react';
import {
  Elements,
  PaymentElement,
  PaymentMethodMessagingElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { loadStripe, type Appearance, type Stripe } from '@stripe/stripe-js';
import { Loader2Icon, LockIcon } from 'lucide-react';
import { Button, formatPrice } from '@play/ui';
import type { CourseCheckoutResponse } from '@play/types';
import { billingDetailsOf } from '@/lib/billing-address';
import { useDarkDocument, useElementsAppearance } from '@/lib/stripe-appearance';

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
 *
 * ## Which methods are offered is the account's decision
 *
 * The intent is created with `automatic_payment_methods`, so the form shows every
 * method the Stripe account has activated that fits the currency and the amount:
 * a card, and — once they are enabled in the dashboard — Klarna, Afterpay and
 * Affirm beside it. None of that is code in this app, deliberately: the two
 * exceptions are the card form's SetupIntent, which has to collect a *card*
 * because a row in the wallet is drawn from what it saves, and nothing here.
 * There is nothing to switch on in this file.
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
    <div className="grid gap-8">
      <Instalments stripe={stripe} session={session} appearance={appearance} />

      <Elements stripe={stripe} options={{ clientSecret: session.clientSecret, appearance }}>
        <PaymentFields session={session} onPaid={onPaid} />
      </Elements>
    </div>
  );
}

/**
 * The three plans that are not a card, offered before the form rather than inside
 * it.
 *
 * Klarna, Afterpay — Clearpay in the UK — and Affirm are what make a course that
 * costs more than somebody wanted to spend today *affordable*, and a checkout
 * that only mentions them after the card fields is one that asks for the whole
 * amount before saying there was another way.
 *
 * ## Drawn by Stripe, not by this app
 *
 * The block is Stripe's own **Payment Method Messaging Element**: the real
 * logos, the real arithmetic ("4 interest-free payments of $20", "as low as
 * $7/month"), and the link to the terms. That is not laziness — an instalment
 * plan is a promise about money, and the only party that knows whether the
 * promise holds for *this* buyer, in *this* country, at *this* amount is Stripe.
 * Chips drawn here would be this product advertising a plan it cannot honour, and
 * the element draws **nothing at all** when no plan is available, which is the
 * right answer to "are there four payments?" when there are not.
 *
 * ## Its own `Elements`, with no client secret, and the page's own theme
 *
 * The messaging element is a **standalone** one: it is told the amount, the
 * currency and the buyer's country as options, and it answers with a sentence
 * rather than being part of a payment. So it gets an `Elements` provider with no
 * client secret of its own, beside the payment's rather than inside it — inside,
 * it would be handed a second set of options that describe a different intent,
 * and there is exactly one intent on this page.
 *
 * It is handed the **appearance** all the same, for the reason the card form
 * learned the hard way: an Element draws inside Stripe's own document, where
 * nothing is inherited, so a page in night mode gets Stripe's default black text
 * on a black page unless the theme is said out loud. The messaging element has no
 * appearance option of its own — only a logo colour — so the theme comes from the
 * `Elements` it is created in, and the logos are the one thing it has to be told
 * separately: colour on a light page, white on a dark one, because Affirm's
 * wordmark is black and would otherwise be a blank space.
 *
 * ## And nothing at all outside the markets Stripe messages for
 *
 * Two fixed lists decide that, both copied from Stripe's own type: the currencies
 * it will quote an instalment plan in, and the countries. A course priced in
 * something else, or a buyer whose country nobody has recorded yet — it is kept
 * on their Stripe customer, written there by the card form or by the last
 * purchase — gets no instalment line rather than a wrong one. **The payment
 * methods themselves are unaffected**: the Element below offers Klarna and
 * Afterpay whatever this block does, because the form is where the choice is made
 * and this is only the advertisement.
 */
function Instalments({
  stripe,
  session,
  appearance,
}: {
  stripe: Promise<Stripe | null>;
  session: CourseCheckoutResponse;
  appearance: Appearance;
}) {
  const dark = useDarkDocument();
  const currency = messagingCurrency(session.currency);
  // The buyer's country comes out of the address the same answer carried: it is
  // a question about where they are, and the address is the only place Stripe has
  // ever been told.
  const country = messagingCountry(session.billingAddress?.country ?? null);
  if (!currency || !country) return null;

  return (
    <Elements stripe={stripe} options={{ appearance }}>
      <PaymentMethodMessagingElement
        options={{
          amount: session.amountCents,
          currency,
          countryCode: country,
          paymentMethodTypes: [...BUY_NOW_PAY_LATER],
          logoColor: dark ? 'white' : 'color',
        }}
      />
    </Elements>
  );
}

/** The plans this block asks Stripe about, in the order they are offered. */
const BUY_NOW_PAY_LATER = ['affirm', 'afterpay_clearpay', 'klarna'] as const;

/** The currencies Stripe quotes an instalment plan in. */
const MESSAGING_CURRENCIES = ['USD', 'GBP', 'EUR', 'DKK', 'NOK', 'SEK', 'AUD', 'CAD', 'NZD'] as const;

/** The countries it messages for. */
const MESSAGING_COUNTRIES = [
  'US', 'CA', 'AU', 'NZ', 'GB', 'IE', 'FR', 'ES',
  'DE', 'AT', 'BE', 'DK', 'FI', 'IT', 'NL', 'NO', 'SE',
] as const;

type MessagingCurrency = (typeof MESSAGING_CURRENCIES)[number];
type MessagingCountry = (typeof MESSAGING_COUNTRIES)[number];

/** The course's currency, if Stripe quotes instalment plans in it. */
function messagingCurrency(currency: string | undefined): MessagingCurrency | null {
  const upper = (currency ?? '').toUpperCase();
  return (MESSAGING_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as MessagingCurrency)
    : null;
}

/** The buyer's country, if Stripe messages for it. */
function messagingCountry(country: string | null): MessagingCountry | null {
  const upper = (country ?? '').toUpperCase();
  return (MESSAGING_COUNTRIES as readonly string[]).includes(upper)
    ? (upper as MessagingCountry)
    : null;
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
   * payment that does need one — a bank's own page, Klarna's or Afterpay's own
   * approval, a wallet that leaves the site — is sent to Stripe and comes back to
   * the course page, which is what `returnUrl` is.
   *
   * A failure is shown as Stripe's own sentence, which names the field: a
   * declined card says so, and a postal code that does not fit the country says
   * that. Then the reader is sent — by the page above, not from here — to the
   * course, where the panel waits for an enrolment it cannot see yet. **This is
   * the one thing that is not Stripe's**: `confirmPayment` resolving is not the
   * same fact as the webhook having arrived, and with Klarna or Afterpay it is
   * not even the same fact as the money having cleared.
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
    <div className="grid gap-5">
      {/* The address the buyer used last time, so nobody types a postal code
          twice. It comes back with the client secret — see `billingDetailsOf`
          for why the mapping lives in one place rather than in both forms. */}
      <PaymentElement
        options={{ defaultValues: { billingDetails: billingDetailsOf(session.billingAddress) } }}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button
        size="lg"
        className="h-11 w-full gap-1.5"
        onClick={() => void pay()}
        disabled={busy || !stripe}
      >
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
