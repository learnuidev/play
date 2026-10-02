import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { spaceMemberKeys } from '@api/modules/space-member/space-member.queries';

export const billingKeys = {
  all: ['billing'] as const,
  /** The receipts, and the cards — both the caller's own, both under `/me`. */
  payments: () => ['billing', 'payments'] as const,
  paymentMethods: () => ['billing', 'payment-methods'] as const,
};

/**
 * The cards this person has saved.
 *
 * Read once and held: a card changes when somebody adds or removes one on this
 * screen, and both of those write the cache below. Signed out it is a 401 rather
 * than an empty list, so the screen that reads it is behind a gate — the account
 * pages are.
 */
export function usePaymentMethods() {
  return useQuery({
    queryKey: billingKeys.paymentMethods(),
    queryFn: () => api.listPaymentMethods(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Adding a card.
 *
 * **Nothing is invalidated here**, and that is the same deliberate asymmetry the
 * checkout flow has: this answers with a Stripe URL and the caller leaves the
 * app, so no card exists yet. The card is written by the webhook, seconds after
 * the person comes back, and the screen they land on is the one that waits for
 * it — a cache refreshed here would be a cache refreshed on a promise.
 */
export function useAddPaymentMethod() {
  return useMutation({
    mutationFn: () => api.startPaymentMethodSetup(),
  });
}

/**
 * Removing one.
 *
 * This *does* invalidate, because it is the one card operation that completes
 * inside the app: Stripe detaches the card and this service forgets it before
 * the response comes back, so the list on screen is stale the moment it lands.
 */
export function useRemovePaymentMethod() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (paymentMethodId: string) => api.removePaymentMethod(paymentMethodId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.paymentMethods() });
    },
  });
}

/**
 * What this person has bought: the receipts.
 *
 * Short-lived, because the one thing that changes it is a refund, and a refund
 * is something the person themselves is doing on the next screen along.
 */
export function useBillingHistory() {
  return useQuery({
    queryKey: billingKeys.payments(),
    queryFn: () => api.listPayments(),
    staleTime: 60 * 1000,
  });
}

/**
 * Asking for a purchase back.
 *
 * What changes when it succeeds is larger than the list it was asked from: the
 * money comes back, the payment moves to `REFUNDED`, and **the course leaves
 * their learning** — so the courses they are taking are invalidated with the
 * receipts. The course page is not invalidated by name because this screen does
 * not know which page that is, and it reads its own membership when it is opened.
 */
export function useRefundPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (paymentId: string) => api.refundPayment(paymentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.payments() });
      void qc.invalidateQueries({ queryKey: spaceMemberKeys.mine() });
    },
  });
}
