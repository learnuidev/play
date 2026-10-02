'use client';

import { useCallback, useMemo, useState } from 'react';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Loader2Icon, LockIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { useSavePaymentMethod, useStartPaymentMethodSetup } from '@play/api';
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
  const setup = useStartPaymentMethodSetup();
  const { resolvedTheme: theme } = useTheme();
  const [session, setSession] = useState<{ clientSecret: string; stripe: Promise<Stripe | null> } | null>(null);

  /**
   * Stripe.js is loaded once per publishable key.
   *
   * `loadStripe` is memoised by Stripe's own module on the key, so calling it
   * again for the same deployment costs nothing — but the *promise* is held here
   * too, because an `Elements` provider given a new promise on every render
   * remounts its children, and a card form that remounts clears itself.
   */
  const stripePromise = useMemo(() => session?.stripe ?? null, [session]);

  const begin = useCallback(async () => {
    try {
      const intent = await setup.mutateAsync();
      setSession({
        clientSecret: intent.clientSecret,
        stripe: loadStripe(intent.publishableKey),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the card form');
    }
  }, [setup]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSession(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a card</DialogTitle>
          <DialogDescription>
            Saved with Stripe, our payment provider. We keep the brand and the last four digits so
            you can tell your cards apart.
          </DialogDescription>
        </DialogHeader>

        {/* The intent is fetched when the dialog opens rather than with the page:
            a client secret is per attempt, and one minted on a page load is one
            that expires before somebody finishes reading the sentence above. */}
        {!session ? (
          <Button onClick={() => void begin()} disabled={setup.isPending}>
            {setup.isPending ? <Loader2Icon className="animate-spin" /> : null}
            {setup.isPending ? 'Preparing…' : 'Start'}
          </Button>
        ) : (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: session.clientSecret,
              // The app's own radius, and the theme the reader is actually in:
              // an Element with its own fixed palette reads as somebody else's
              // form dropped into this page.
              appearance: {
                theme: theme === 'dark' ? 'night' : 'stripe',
                variables: { borderRadius: '12px' },
              },
            }}
          >
            <CardForm
              clientSecret={session.clientSecret}
              onSaved={() => {
                setSession(null);
                onOpenChange(false);
              }}
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
function CardForm({ clientSecret, onSaved }: { clientSecret: string; onSaved: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const save = useSavePaymentMethod();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!stripe || !elements) return;

    const card = elements.getElement(CardElement);
    if (!card) return;

    setBusy(true);
    setError(null);

    // The secret is the intent's own and the Element fills the payment method
    // in: nothing about the card reaches this app.
    const result = await stripe.confirmCardSetup(clientSecret, { payment_method: { card } });

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
      <div className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
        <CardElement
          options={{
            hidePostalCode: false,
            style: {
              base: {
                fontSize: '14px',
                color: 'inherit',
                '::placeholder': { color: 'rgb(148 163 184)' },
              },
              invalid: { color: 'rgb(248 113 113)' },
            },
          }}
        />
      </div>

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
