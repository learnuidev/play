import type { StripePaymentElementOptions } from '@stripe/stripe-js';
import type { BillingAddress } from '@play/types';

/**
 * What a Stripe Element needs to open on an address this product already knows.
 *
 * ## Why this is a function and not an object at each call site
 *
 * Two forms prefill a billing address — the wallet's card form and the
 * marketplace's checkout — and both are handed the same `BillingAddress` from
 * the API. They are also both handed it in Stripe's *other* spelling: our fields
 * are camel case (`postalCode`) because they are what this product reads, and the
 * Element's are snake case (`postal_code`) because they are what Stripe's API
 * reads. Written out twice, one of them ends up with a `postalCode` key Stripe
 * silently ignores — which is a form that looks pre-filled to the screen it was
 * typed on and empty to the person looking at it.
 *
 * ## Empty is `undefined`, not an empty object
 *
 * A reader who has never told us anything gets `undefined`, which is the
 * Element's own "no defaults" — rather than an object with every field empty,
 * which is a different instruction that happens to look the same in a diff.
 */
export function billingDetailsOf(
  address: BillingAddress | null | undefined,
): NonNullable<StripePaymentElementOptions['defaultValues']>['billingDetails'] {
  const fields = {
    ...(address?.line1 ? { line1: address.line1 } : {}),
    ...(address?.line2 ? { line2: address.line2 } : {}),
    ...(address?.city ? { city: address.city } : {}),
    ...(address?.state ? { state: address.state } : {}),
    ...(address?.postalCode ? { postal_code: address.postalCode } : {}),
    ...(address?.country ? { country: address.country } : {}),
  };

  return Object.keys(fields).length > 0 ? { address: fields } : undefined;
}
