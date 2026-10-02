'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2Icon, ReceiptTextIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useBillingHistory, useRefundPayment } from '@play/api';
import { REFUND_WINDOW_DAYS, type BillingEntry, type PaymentStatus } from '@play/types';
import { formatDate, formatPrice } from '@play/ui';
import { Badge } from '@ui/components/ui/badge';
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
 * What this person has bought, and what they can do about it.
 *
 * ## The receipts
 *
 * Every attempt rather than only the ones that went through: a checkout somebody
 * abandoned and a card that was declined are both things a person opens this page
 * to find, and a list that showed only the sales would leave them with nothing to
 * look at and no explanation. They are drawn differently — a paid row is a
 * receipt, an abandoned one is a sentence — which is the whole reason the status
 * travels with the row instead of being filtered out here.
 *
 * ## The refund
 *
 * A purchase can be undone for **30 days**, and the button is inside the receipt
 * because a refund is a question about one payment rather than about the list.
 * The deadline is the API's — it answers `refundable` and `refundDeadline`, and
 * this screen prints them — so the button and the rule behind it cannot disagree
 * about the day the window closes.
 *
 * Nothing here decides anything about the money: pressing the button asks the API
 * for the refund, Stripe returns the charge, and the course leaves their learning
 * with it. A refusal comes back as the API's own sentence — already refunded, the
 * 30 days are up, the payment never completed — and is shown as written.
 */
export default function BillingHistoryPage() {
  const { data, isLoading, isError, error } = useBillingHistory();
  const payments = data?.payments ?? [];
  const [receipt, setReceipt] = useState<BillingEntry | null>(null);

  return (
    <section className="grid gap-6 rounded-3xl border border-border/60 bg-card p-6">
      <header>
        <h2 className="text-base font-semibold tracking-tight">Billing history</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every course you have paid for, and every checkout that did not go through.
        </p>
      </header>

      {isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Could not load your receipts'}
        </p>
      ) : payments.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <ReceiptTextIcon className="size-4 text-muted-foreground" />
          </span>
          <p className="text-sm font-medium tracking-tight">Nothing bought yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            When you pay for a course, its receipt appears here — along with the {REFUND_WINDOW_DAYS}{' '}
            days you have to change your mind.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-1">
            <Link href="/discover">Discover courses</Link>
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3">
          {payments.map((payment) => (
            <li
              key={payment.paymentId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border/60 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {payment.courseTitle || 'A course that is no longer listed'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(payment.paidAt ?? payment.createdAt)}
                  {payment.refundedAt ? ` · refunded ${formatDate(payment.refundedAt)}` : ''}
                </p>
              </div>

              <StatusBadge status={payment.status} />

              <span className="text-sm tabular-nums">
                {formatPrice(payment.amountCents, payment.currency)}
              </span>

              <Button variant="outline" size="sm" onClick={() => setReceipt(payment)}>
                Receipt
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} />
    </section>
  );
}

/**
 * One receipt, and the one thing that can be done to it.
 *
 * A dialog rather than a page of its own: a receipt is a few lines about one
 * payment, and a route per purchase would be a screen whose whole content is
 * something the list already has in hand.
 */
function ReceiptDialog({
  payment,
  onClose,
}: {
  payment: BillingEntry | null;
  onClose: () => void;
}) {
  const refund = useRefundPayment();
  const [confirming, setConfirming] = useState(false);

  async function askForRefund() {
    if (!payment) return;
    try {
      await refund.mutateAsync(payment.paymentId);
      setConfirming(false);
      onClose();
      toast.success('Refund on its way', {
        description:
          'The money is going back to your card and the course has left your learning. Progress is kept if you buy it again.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not refund this payment');
    }
  }

  return (
    <Dialog
      open={payment !== null}
      onOpenChange={(open) => {
        if (!open) {
          setConfirming(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        {payment && (
          <>
            <DialogHeader>
              <DialogTitle>Receipt</DialogTitle>
              <DialogDescription>
                {payment.courseTitle || 'A course that is no longer listed'}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-2 text-sm">
              <Line label="Amount">
                {formatPrice(payment.amountCents, payment.currency)}
              </Line>
              <Line label="Status">{statusSentence(payment.status)}</Line>
              <Line label="Started">{formatDate(payment.createdAt)}</Line>
              {payment.paidAt && <Line label="Paid">{formatDate(payment.paidAt)}</Line>}
              {payment.refundedAt && (
                <Line label="Refunded">{formatDate(payment.refundedAt)}</Line>
              )}
              {/* The Stripe session id, which is what support asks for and what
                  makes this row findable in the dashboard. Kept short of the
                  payment intent: nobody outside this service needs that. */}
              <Line label="Reference">
                <span className="break-all font-mono text-xs">{payment.paymentId}</span>
              </Line>
            </dl>

            {payment.status === 'PAID' && (
              <div className="grid gap-2 rounded-2xl bg-muted/50 p-4">
                {payment.refundable ? (
                  <>
                    <p className="text-sm">
                      {payment.refundDeadline
                        ? `You can ask for this back until ${formatDate(payment.refundDeadline)}.`
                        : `You have ${REFUND_WINDOW_DAYS} days from paying to ask for this back.`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      A refund returns the money to your card and takes the course out of your
                      learning. Your progress is kept if you buy it again.
                    </p>
                    {confirming ? (
                      <div className="mt-1 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirming(false)}
                          disabled={refund.isPending}
                        >
                          Keep the course
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void askForRefund()}
                          disabled={refund.isPending}
                        >
                          {refund.isPending ? <Loader2Icon className="animate-spin" /> : null}
                          {refund.isPending ? 'Refunding…' : 'Yes, refund it'}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 justify-self-start"
                        onClick={() => setConfirming(true)}
                      >
                        Ask for a refund
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The {REFUND_WINDOW_DAYS} days to ask for a refund on this purchase have passed.
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant={status === 'PAID' ? 'secondary' : 'outline'}>
      {statusSentence(status)}
    </Badge>
  );
}

/**
 * A status as a sentence.
 *
 * `EXPIRED` is the one worth spelling out: it is Stripe's word for a checkout
 * nobody finished, and to a person reading their own history that is "you
 * started this and did not go through with it" rather than anything about a
 * session having lapsed.
 */
function statusSentence(status: PaymentStatus): string {
  switch (status) {
    case 'PAID':
      return 'Paid';
    case 'PENDING':
      return 'Payment pending';
    case 'FAILED':
      return 'Payment failed';
    case 'EXPIRED':
      return 'Not completed';
    case 'REFUNDED':
      return 'Refunded';
  }
}
