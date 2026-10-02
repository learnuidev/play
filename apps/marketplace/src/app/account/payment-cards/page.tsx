'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CreditCardIcon, Loader2Icon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  billingKeys,
  useAddPaymentMethod,
  usePaymentMethods,
  useRemovePaymentMethod,
} from '@play/api';
import type { SavedPaymentMethod } from '@play/types';
import { formatDate } from '@play/ui';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/components/ui/dialog';
import { Skeleton } from '@ui/components/ui/skeleton';

/**
 * The cards somebody has saved for the next time they buy a course.
 *
 * ## Why the form is not here
 *
 * There is no card field on this page, and that is the design rather than an
 * omission: a card number typed into a page this repository serves would be a
 * card number this repository stores, and the whole of what makes that safe is
 * that it never touches us. "Add a card" sends the browser to Stripe's own
 * hosted form — the same page a purchase is paid on, in `mode=setup` so nothing
 * can be charged from it — and Stripe hands back a token this service stores
 * instead of a card.
 *
 * What is stored is the token, the brand, the last four digits and the expiry.
 * The screen says exactly that rather than promising what Stripe will do with
 * the card afterwards, which is Stripe's own configuration to decide.
 *
 * ## Why the page waits after the redirect
 *
 * Stripe sends the browser back the moment the card is entered, and the row that
 * remembers it is written by the webhook a second or two later. So a page that
 * simply redrew its list would show a person the cards they had *before* the one
 * they just added — which reads as a save that did not work. While `?added=1` is
 * set, the page polls for the new card instead, and says what it is doing.
 */
export default function PaymentCardsPage() {
  return (
    // `useSearchParams` needs a boundary in the App Router, which is the whole
    // reason this page is split in two: the flag Stripe comes back with is read
    // below it rather than above.
    <Suspense
      fallback={
        <div className="grid gap-3 rounded-3xl border border-border/60 bg-card p-6">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      }
    >
      <PaymentCards />
    </Suspense>
  );
}

/** The screen itself, below the boundary the query string needs. */
function PaymentCards() {
  const search = useSearchParams();
  const returning = search.get('added') === '1';

  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = usePaymentMethods();
  const cards = data?.paymentMethods ?? [];

  /**
   * How many cards there were when this mount settled on an answer.
   *
   * The count and not a flag, because somebody with one card who adds a second
   * starts with a non-empty list: "wait for it to stop being empty" would stop
   * immediately and say nothing. What is being waited for is one **more** card
   * than this.
   */
  const [baseline, setBaseline] = useState<number | null>(null);
  useEffect(() => {
    if (baseline === null && !isLoading) setBaseline(cards.length);
  }, [baseline, isLoading, cards.length]);

  // Four attempts over about ten seconds, exactly as the course page does after
  // a payment: what is being waited for is a webhook with no channel to this
  // browser, and a card that has not arrived by then is one to reload for.
  const [waited, setWaited] = useState(0);
  /** Whether the card that was just entered has turned up in the list. */
  const arrived = baseline !== null && cards.length > baseline;
  const waiting = returning && baseline !== null && !arrived && waited < 4;
  const gaveUp = returning && baseline !== null && !arrived && !waiting;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setWaited((n) => n + 1);
      void queryClient.invalidateQueries({ queryKey: billingKeys.paymentMethods() });
    }, 2500);
    return () => clearTimeout(timer);
  }, [waiting, queryClient]);

  const add = useAddPaymentMethod();
  const remove = useRemovePaymentMethod();
  const [confirming, setConfirming] = useState<SavedPaymentMethod | null>(null);

  async function startAdding() {
    try {
      const session = await add.mutateAsync();
      window.location.assign(session.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the card form');
    }
  }

  async function confirmRemoval() {
    if (!confirming) return;
    try {
      await remove.mutateAsync(confirming.paymentMethodId);
      setConfirming(null);
      toast.success('Card removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that card');
    }
  }

  return (
    <section className="grid gap-6 rounded-3xl border border-border/60 bg-card p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Payment cards</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cards are held by Stripe, our payment provider. We keep the brand and the last four
            digits so you can tell them apart.
          </p>
        </div>
        <Button size="sm" onClick={() => void startAdding()} disabled={add.isPending}>
          {add.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          {add.isPending ? 'Opening Stripe…' : 'Add a card'}
        </Button>
      </header>

      {waiting ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2Icon className="animate-spin size-4" />
          Stripe has your card and the confirmation is on its way. This page is checking for it.
        </p>
      ) : null}

      {/* Said out loud rather than left to be noticed: the list below changes a
          second after the redirect, and a person who has just entered a card
          should be told that it worked rather than left to count rows. */}
      {returning && arrived ? (
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          Your card is saved. Remove it whenever you like.
        </p>
      ) : null}

      {gaveUp ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Stripe has your card. It appears here as soon as the confirmation reaches us — reload this
          page in a moment and it will be here.
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Could not load your cards'}
        </p>
      ) : cards.length === 0 ? (
        // An empty state that is composed rather than coloured: a muted icon, the
        // heading's own voice, a sentence of explanation, and the action.
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <CreditCardIcon className="size-4 text-muted-foreground" />
          </span>
          <p className="text-sm font-medium tracking-tight">No cards saved</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Saving one is optional — you can always enter a card when you pay for a course. A card
            saved here is held against your account, and you can remove it whenever you like.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {cards.map((card) => (
            <li
              key={card.paymentMethodId}
              className="flex items-center gap-4 rounded-2xl border border-border/60 px-4 py-3"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
                <CreditCardIcon className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {brandName(card.brand)} <span className="font-normal">ending {card.last4}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires {String(card.expMonth).padStart(2, '0')}/{card.expYear} · Added{' '}
                  {formatDate(card.createdAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(card)}
                disabled={remove.isPending}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this card?</DialogTitle>
            <DialogDescription>
              {confirming
                ? `${brandName(confirming.brand)} ending ${confirming.last4} is removed from your account with Stripe, so nothing can be charged to it here again.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmRemoval()}
              disabled={remove.isPending}
            >
              {remove.isPending ? <Loader2Icon className="animate-spin" /> : null}
              Remove card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * A brand as a person writes it.
 *
 * Stripe answers in its own vocabulary — `visa`, `mastercard`, `amex` — and the
 * abbreviations are the part worth expanding, because a card is recognized by
 * the word on it. An unknown brand is left as Stripe sent it rather than
 * guessed at: a card this screen has not seen before should read oddly, not
 * wrongly.
 */
function brandName(brand: string): string {
  const known: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
    diners: 'Diners Club',
    unionpay: 'UnionPay',
    jcb: 'JCB',
  };
  return known[brand] ?? brand;
}
