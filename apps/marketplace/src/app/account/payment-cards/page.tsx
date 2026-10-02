'use client';

import { useState } from 'react';
import { CreditCardIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import {
  usePaymentMethods,
  useRemovePaymentMethod,
  useSetDefaultPaymentMethod,
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
import { Badge } from '@ui/components/ui/badge';
import { AddCardDialog } from '@/components/account/add-card-dialog';
import { brandName, CardBrandMark } from '@/components/account/card-brand-mark';

/**
 * The cards somebody has saved for the next time they buy a course.
 *
 * **The form is a dialog this app draws with Stripe Elements**, and the two
 * halves of that are worth separating. The *field* is Stripe's: the number is
 * typed into Stripe's own iframe, so it never touches this app's DOM and this
 * page is not in PCI scope. The *form* is ours: which methods are offered, what
 * the frame looks like, and what happens next — and that is what makes a saved
 * card a card.
 *
 * The hosted page this replaced offered Stripe Link as well, somebody used it,
 * and the payment method came back as `link` — no brand, no last four digits,
 * nothing this screen could draw. A form that collects a card collects a card.
 *
 * ## Nothing to wait for
 *
 * The card used to be written by a webhook, so this page had to poll for a row
 * it could not see coming. The dialog now quotes the confirmed setup intent back
 * to the API, the API checks it with Stripe and writes the row, and the list is
 * redrawn from that answer: the card is in the wallet the moment it is saved.
 */
export default function PaymentCardsPage() {
  const { data, isLoading, isError, error } = usePaymentMethods();
  const cards = data?.paymentMethods ?? [];

  const remove = useRemovePaymentMethod();
  const makeDefault = useSetDefaultPaymentMethod();
  /** The card whose removal is being confirmed, if one is. */
  const [confirming, setConfirming] = useState<SavedPaymentMethod | null>(null);
  /** Whether the add-a-card dialog is open. */
  const [adding, setAdding] = useState(false);

  async function setAsDefault(card: SavedPaymentMethod) {
    try {
      await makeDefault.mutateAsync(card.paymentMethodId);
      toast.success(`${brandName(card.brand)} ending ${card.last4} is now your default card`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not set that card as the default');
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
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add a card
        </Button>
      </header>

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
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-border/60 px-4 py-3"
            >
              {/* The brand as its own mark: a wallet is read by shape, which is
                  the thing a list of four-digit numbers cannot be. */}
              <CardBrandMark brand={card.brand} />

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {brandName(card.brand)} <span className="font-normal">ending {card.last4}</span>
                  {card.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires {String(card.expMonth).padStart(2, '0')}/{card.expYear} · Added{' '}
                  {formatDate(card.createdAt)}
                </p>
              </div>

              <div className="flex items-center gap-1">
                {/* **A word here and an icon there**, and the asymmetry is
                    deliberate: "make default" is not an action a drawing says
                    unambiguously — a star reads as favourite as readily as it
                    reads as default, and a tick reads as "already done" — while
                    a bin is a bin. It is shown only on the cards that are *not*
                    the default, because a control that would set the state it is
                    already in does nothing, and the badge beside the name says
                    which card it is. */}
                {card.isDefault ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void setAsDefault(card)}
                    disabled={makeDefault.isPending || remove.isPending}
                  >
                    Make default
                  </Button>
                )}

                {/* The one action an icon says better than a sentence, and the
                    one worth keeping small: taking a card away should take a
                    deliberate aim. The label names the card, because an icon
                    with no accessible name is a button nobody using a screen
                    reader can press. */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setConfirming(card)}
                  disabled={remove.isPending}
                  title={`Remove the card ending ${card.last4}`}
                  aria-label={`Remove the card ending ${card.last4}`}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddCardDialog open={adding} onOpenChange={setAdding} />

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
