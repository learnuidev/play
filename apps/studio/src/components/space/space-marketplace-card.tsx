'use client';

import { useEffect, useState } from 'react';
import { ExternalLinkIcon, EyeIcon, EyeOffIcon, Loader2Icon, StoreIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Space } from '@play/types';
import { useUpdateSpace } from '@api/modules/space/space.queries';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { cn, formatPrice, isPaid } from '@ui/lib/utils';
import { BlockLabel } from '@/components/shell/page-card';

/**
 * Where the marketplace lives.
 *
 * A link to somewhere else is configuration, not a route: the two apps are
 * deployed separately and the studio has no way to derive the marketplace's
 * address from its own. Unset means this deployment has no marketplace, and the
 * card says what publishing would do without pretending to offer it.
 */
const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? '').replace(/\/+$/, '');

/** The single URL that means "every listed course". */
const MARKETPLACE_CATALOG_URL = MARKETPLACE_URL ? `${MARKETPLACE_URL}/courses` : '';

/**
 * Publishing a course, and unpublishing it again.
 *
 * Its own card with its own save, rather than another field on the details
 * form: what a course is called is edited while writing it, and whether strangers
 * may find it is a decision taken once, deliberately — the sort of thing that
 * should not be sitting one stray click away from a title field.
 *
 * Listing a course is what puts it in the marketplace catalog, where anybody —
 * signed in or not — can read what it is, see its syllabus, and register for it.
 */
export function SpaceMarketplaceCard({ space, canEdit }: { space: Space; canEdit: boolean }) {
  const update = useUpdateSpace(space.spaceId);
  const [listed, setListed] = useState(Boolean(space.listed));

  // The course can change under this card — somebody else's publish arriving
  // with the list — so the switch follows the course rather than the click.
  const published = Boolean(space.listed);

  async function publish(next: boolean) {
    setListed(next);
    try {
      await update.mutateAsync({ listed: next });
      toast.success(next ? 'Course published to the marketplace' : 'Course removed from the marketplace');
    } catch (err) {
      // Put the switch back where the server still has it.
      setListed(!next);
      toast.error(err instanceof Error ? err.message : 'Could not change who can find this course');
    }
  }

  return (
    <section className="grid gap-3">
      <BlockLabel
        action={
          published && MARKETPLACE_CATALOG_URL ? (
            <a
              href={`${MARKETPLACE_CATALOG_URL}/${space.spaceId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLinkIcon className="size-3.5" />
              View in marketplace
            </a>
          ) : undefined
        }
      >
        Marketplace
      </BlockLabel>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border/60 bg-card p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl',
              published ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
            )}
          >
            {published ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
          </span>

          <div className="min-w-0">
            <p className="text-sm font-medium">
              {published ? 'Listed in the marketplace' : 'Only your community can see this course'}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {published
                ? 'Anyone can find this course, read its syllabus and register for it. Lessons stay members-only.'
                : 'Publishing lists this course in the marketplace catalog, where anybody can find it and register.'}
            </p>
          </div>
        </div>

        <Button
          variant={published ? 'outline' : 'default'}
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={!canEdit || update.isPending}
          onClick={() => void publish(!listed)}
        >
          {update.isPending ? (
            <Loader2Icon className="animate-spin" />
          ) : published ? (
            <EyeOffIcon />
          ) : (
            <StoreIcon />
          )}
          {published ? 'Unlist' : 'Publish'}
        </Button>
      </div>

      {!MARKETPLACE_URL && (
        <p className="text-xs text-muted-foreground">
          This deployment has no marketplace configured, so a listed course has no catalog to
          appear in yet. Set <code>NEXT_PUBLIC_MARKETPLACE_URL</code> to point at one.
        </p>
      )}

      <SpacePriceRow space={space} canEdit={canEdit} published={published} />
    </section>
  );
}

/**
 * What a course costs: the second half of publishing it.
 *
 * Beside the publish switch rather than on the details form, because the two are
 * one decision — a course going into a catalog is a course somebody can be
 * charged for, and an author who lists one and has to go looking for where to put
 * a price will list it free by accident. It is drawn even on an unlisted course,
 * where it says what it will mean when the course is published, because setting
 * the price first and publishing second is the sensible order.
 *
 * **The amount is the only thing here.** Stripe's price object is created by the
 * backend the first time somebody checks out — cached on the course from then on
 * — so changing what a course costs is changing a number, and the stale Stripe
 * price is replaced on the next purchase rather than chased through a dashboard.
 *
 * The field is in *dollars* and the API takes cents, and the conversion happens
 * on the way out: a person types `49`, and the rounding is `Math.round` so that
 * `49.99` becomes 4999 rather than 4998.9999999999995.
 */
function SpacePriceRow({
  space,
  canEdit,
  published,
}: {
  space: Space;
  canEdit: boolean;
  published: boolean;
}) {
  const update = useUpdateSpace(space.spaceId);
  const [amount, setAmount] = useState(toDollars(space.priceCents));
  const [currency, setCurrency] = useState(space.currency ?? 'usd');

  // The course can change under this card — the save's own response arrives as
  // new props — so the field follows the server rather than the typing, exactly
  // as the publish switch does.
  useEffect(() => {
    setAmount(toDollars(space.priceCents));
    setCurrency(space.currency ?? 'usd');
  }, [space.priceCents, space.currency]);

  // Three outcomes from one field, told apart once so nothing below has to: the
  // cents to save, "free", or a typo that must not be saved at all.
  const parsed = parseAmount(amount);
  const invalid = parsed === 'invalid';
  const cents = invalid ? null : parsed;
  const unchanged = cents === (space.priceCents ?? null) && currency === (space.currency ?? 'usd');

  async function save(nextCents: number | null) {
    try {
      await update.mutateAsync({ priceCents: nextCents, currency });
      toast.success(
        nextCents === null
          ? 'This course is free again'
          : `This course now costs ${formatPrice(nextCents, currency)}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the price');
    }
  }

  return (
    <div className="grid gap-3 rounded-3xl border border-border/60 bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {isPaid(space) ? `Costs ${formatPrice(space.priceCents ?? 0, space.currency)}` : 'Free to register'}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {isPaid(space)
              ? 'A learner pays once, through Stripe, and is enrolled when the payment clears. Leaving the course does not refund it.'
              : published
                ? 'Anyone can register without paying. Set an amount to charge for this course instead.'
                : 'Applies when this course is published. Set an amount to charge for it, or leave it empty to keep it free.'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            disabled={!canEdit || update.isPending}
            aria-label="Currency"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 disabled:opacity-60"
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </select>

          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={!canEdit || update.isPending}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Price"
            className="w-28 text-right tabular-nums"
          />

          <Button
            size="sm"
            disabled={!canEdit || update.isPending || invalid || unchanged}
            onClick={() => void save(cents)}
          >
            {update.isPending ? <Loader2Icon className="animate-spin" /> : null}
            {isPaid(space) && cents === null ? 'Make free' : 'Save price'}
          </Button>
        </div>
      </div>

      {invalid ? (
        <p className="text-xs text-destructive">
          A price is a number with at most two decimals — leave it empty, or type something like
          49 or 49.99.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The currencies a course may be priced in. The same short list the API checks
 * against, and short on purpose: a typo in a three-letter code is a Stripe
 * rejection at the moment somebody is trying to buy something.
 */
const CURRENCIES = ['usd', 'eur', 'gbp', 'inr', 'aud', 'cad'];

/** `4900` → `'49.00'`, for a text field. Absent and zero both mean free. */
function toDollars(cents: number | undefined): string {
  if (!cents) return '';
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

/**
 * What was typed, in cents.
 *
 * `null` is "empty, so free" and `'invalid'` is something that is not money —
 * distinguished because they are different mistakes: one is a course being made
 * free, and the other is a typo that must not be saved as anything at all.
 */
function parseAmount(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return 'invalid';

  const cents = Math.round(Number(trimmed) * 100);
  // The API's own ceiling, said here so the field refuses it rather than the
  // save: this box is dollars, and the mistake it guards against is typing the
  // cents into it.
  if (cents <= 0) return null;
  if (cents > 1_000_000) return 'invalid';
  return cents;
}
