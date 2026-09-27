'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import {
  REWARD_KINDS,
  REWARD_KIND_DESCRIPTIONS,
  REWARD_KIND_LABELS,
  REWARD_MILESTONE_LABELS,
  REWARD_MILESTONE_TYPES,
  REWARD_MILESTONE_UNITS,
  type CreateRewardPayload,
  type RewardKind,
  type RewardMilestoneType,
  type SpaceReward,
  type UpdateRewardPayload,
} from '@play/types';
import { useCreateReward, useUpdateReward } from '@api/modules/reward/reward.queries';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ui/components/ui/dialog';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Textarea } from '@ui/components/ui/textarea';

// The same limits the API enforces, so an obvious mistake fails here instead of
// after a round trip. They are duplicated deliberately: the server stays the
// authority, and this only saves the wait.
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_INSTRUCTIONS_LENGTH = 1000;
const MAX_GRANT_LIMIT = 1_000_000;
/** Lessons completed has no natural ceiling, but the API stops at ten thousand. */
const MAX_LESSONS_MILESTONE = 10_000;
/** The API's ceiling on a face value, in cents — one million in the major unit. */
const MAX_AMOUNT_CENTS = 100_000_000;
const DEFAULT_CURRENCY = 'USD';

/** A code prefix is read off a screen and typed into a checkout. */
const PREFIX_PATTERN = /^[A-Za-z0-9-]{2,16}$/;
/** ISO-4217, as far as this form cares: three letters. */
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

/**
 * The major unit as a person types it, in cents as the API stores it.
 *
 * Returns `undefined` for anything that is not a positive amount, which is how
 * the gift-card validation below is written: there is no "amount of zero" to
 * special-case.
 */
function toCents(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  return Math.round(value * 100);
}

/**
 * Writes a reward, or edits one.
 *
 * Both directions are one form because they are the same fields. The one thing
 * the two modes do not share is the kind: the API refuses to change it, so an
 * edit shows what the reward is rather than offering the switch. That is not a
 * gap to work around — a coupon that has already been handed out is not a
 * balance anybody funded, so a reward that becomes a gift card is a new reward.
 *
 * The kind-specific fields follow from that: a coupon and a gift card carry a
 * code, so they take a prefix; a gift card needs a face value; a custom reward is
 * handed over by a person, so it needs instructions instead of any of that.
 */
export function RewardDialog({
  spaceId,
  reward,
  trigger,
  open,
  onOpenChange,
}: {
  spaceId: string;
  /** Omit to write a new reward. */
  reward?: SpaceReward;
  trigger?: ReactNode;
  /** Controlled openness. Omit to let the trigger manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const [uncontrolled, setUncontrolled] = useState(false);
  const [name, setName] = useState(reward?.name ?? '');
  const [description, setDescription] = useState(reward?.description ?? '');
  const [kind, setKind] = useState<RewardKind>(reward?.kind ?? 'COUPON');
  const [milestoneType, setMilestoneType] = useState<RewardMilestoneType>(
    reward?.milestone.type ?? 'LESSONS_COMPLETED',
  );
  const [milestoneValue, setMilestoneValue] = useState(
    reward ? String(reward.milestone.value) : '',
  );
  const [codePrefix, setCodePrefix] = useState(reward?.codePrefix ?? '');
  const [amount, setAmount] = useState(
    reward?.amountCents !== undefined ? (reward.amountCents / 100).toFixed(2) : '',
  );
  const [currency, setCurrency] = useState(reward?.currency ?? DEFAULT_CURRENCY);
  const [instructions, setInstructions] = useState(reward?.instructions ?? '');
  const [grantLimit, setGrantLimit] = useState(
    reward?.grantLimit !== undefined ? String(reward.grantLimit) : '',
  );
  const [active, setActive] = useState(reward?.active ?? true);

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolled;

  const create = useCreateReward(spaceId);
  const update = useUpdateReward(spaceId);
  const pending = create.isPending || update.isPending;

  /**
   * The form's contents for a reward, or for one being written when there is
   * none.
   *
   * Used in both directions: opening fills the form with the reward as it now
   * is, and closing empties it so an abandoned edit does not come back to life
   * the next time somebody opens the dialog.
   */
  function fill(source?: SpaceReward) {
    setName(source?.name ?? '');
    setDescription(source?.description ?? '');
    setKind(source?.kind ?? 'COUPON');
    setMilestoneType(source?.milestone.type ?? 'LESSONS_COMPLETED');
    setMilestoneValue(source ? String(source.milestone.value) : '');
    setCodePrefix(source?.codePrefix ?? '');
    setAmount(source?.amountCents !== undefined ? (source.amountCents / 100).toFixed(2) : '');
    setCurrency(source?.currency ?? DEFAULT_CURRENCY);
    setInstructions(source?.instructions ?? '');
    setGrantLimit(source?.grantLimit !== undefined ? String(source.grantLimit) : '');
    setActive(source?.active ?? true);
  }

  // Keyed on openness alone: a refetch landing behind an open dialog must not
  // wipe what is being typed into it.
  useEffect(() => {
    if (isOpen) fill(reward);
  }, [isOpen]);

  function setOpen(next: boolean) {
    fill(next ? reward : undefined);
    if (isControlled) onOpenChange?.(next);
    else setUncontrolled(next);
  }

  const trimmedName = name.trim();
  const nameTooShort = trimmedName.length > 0 && trimmedName.length < MIN_NAME_LENGTH;
  const nameValid = trimmedName.length >= MIN_NAME_LENGTH && trimmedName.length <= MAX_NAME_LENGTH;

  const milestoneNumber = Number(milestoneValue);
  const maxMilestone = milestoneType === 'PERCENT_COMPLETE' ? 100 : MAX_LESSONS_MILESTONE;
  const milestoneValid =
    Number.isInteger(milestoneNumber) && milestoneNumber >= 1 && milestoneNumber <= maxMilestone;

  const trimmedPrefix = codePrefix.trim().toUpperCase();
  const prefixValid = trimmedPrefix.length === 0 || PREFIX_PATTERN.test(trimmedPrefix);

  const amountCents = toCents(amount);
  const amountValid =
    kind !== 'GIFT_CARD' || (amountCents !== undefined && amountCents <= MAX_AMOUNT_CENTS);
  const currencyValid = kind !== 'GIFT_CARD' || CURRENCY_PATTERN.test(currency.trim());

  const trimmedInstructions = instructions.trim();
  const instructionsValid =
    kind !== 'CUSTOM' ||
    (trimmedInstructions.length > 0 && trimmedInstructions.length <= MAX_INSTRUCTIONS_LENGTH);

  const trimmedLimit = grantLimit.trim();
  const limitNumber = Number(trimmedLimit);
  // A limit below what a reward has already given out is refused by the API, and
  // rightly: the number on the card is a promise about how many exist.
  const limitValid =
    trimmedLimit.length === 0 ||
    (Number.isInteger(limitNumber) &&
      limitNumber >= 1 &&
      limitNumber <= MAX_GRANT_LIMIT &&
      (!reward || limitNumber >= reward.grantCount));

  const canSubmit =
    nameValid &&
    description.length <= MAX_DESCRIPTION_LENGTH &&
    milestoneValid &&
    prefixValid &&
    amountValid &&
    currencyValid &&
    instructionsValid &&
    limitValid &&
    !pending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    const milestone = { type: milestoneType, value: milestoneNumber };
    const limitValue = trimmedLimit.length > 0 ? limitNumber : undefined;

    try {
      if (reward) {
        // Only the kind's own fields are sent: the kind is fixed, so nothing here
        // can turn one reward into another.
        const patch: UpdateRewardPayload = {
          name: trimmedName,
          description: description.trim(),
          milestone,
          active,
          // An emptied limit is sent as null, which is how the API is told to
          // clear a field rather than leave the old value in place.
          grantLimit: limitValue ?? null,
        };

        if (reward.kind === 'CUSTOM') {
          patch.instructions = trimmedInstructions;
        } else {
          patch.codePrefix = trimmedPrefix.length > 0 ? trimmedPrefix : null;
          if (reward.kind === 'GIFT_CARD' && amountCents !== undefined) {
            patch.amountCents = amountCents;
            patch.currency = currency.trim().toUpperCase();
          }
        }

        await update.mutateAsync({ rewardId: reward.rewardId, ...patch });
        toast.success('Reward updated');
      } else {
        const payload: CreateRewardPayload = {
          name: trimmedName,
          description: description.trim(),
          kind,
          milestone,
        };

        if (kind !== 'CUSTOM' && trimmedPrefix.length > 0) payload.codePrefix = trimmedPrefix;
        if (kind === 'GIFT_CARD' && amountCents !== undefined) {
          payload.amountCents = amountCents;
          payload.currency = currency.trim().toUpperCase();
        }
        if (kind === 'CUSTOM') payload.instructions = trimmedInstructions;
        if (limitValue !== undefined) payload.grantLimit = limitValue;

        await create.mutateAsync(payload);
        toast.success('Reward created');
      }

      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the reward');
    }
  }

  const carriesCode = kind !== 'CUSTOM';

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{reward ? 'Edit reward' : 'New reward'}</DialogTitle>
          <DialogDescription>
            {reward
              ? 'Change what this reward asks for or how it is handed over. What has already been granted stays granted.'
              : 'A reward is what the course hands over when somebody reaches a milestone: a coupon at five lessons, a gift card for finishing.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="reward-name">Name</Label>
            <Input
              id="reward-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Finish the course"
              maxLength={MAX_NAME_LENGTH}
              autoFocus
            />
            {nameTooShort && (
              <p className="text-xs text-destructive">
                At least {MIN_NAME_LENGTH} characters — “{trimmedName}” is too short.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="reward-description">Description</Label>
            <Textarea
              id="reward-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What it is, and what it is for."
              rows={2}
              maxLength={MAX_DESCRIPTION_LENGTH}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/{MAX_DESCRIPTION_LENGTH}
            </p>
          </div>

          {reward ? (
            // The kind is not editable, so it is stated rather than offered: the
            // API refuses the change, because moving a coupon to a gift card
            // would change what was already handed out.
            <div className="grid gap-2">
              <p className="text-sm font-medium leading-none">What it is</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{REWARD_KIND_LABELS[reward.kind]}</Badge>
                <p className="text-xs text-muted-foreground">
                  {REWARD_KIND_DESCRIPTIONS[reward.kind]}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                The kind cannot be changed afterwards. Offer a second reward instead.
              </p>
            </div>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium leading-none">What it is</legend>
              <div className="grid gap-2">
                {REWARD_KINDS.map((option) => {
                  const selected = kind === option;
                  return (
                    <label
                      key={option}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
                        selected ? 'border-ring bg-muted/50' : 'hover:bg-muted/40',
                      )}
                    >
                      <input
                        type="radio"
                        name="reward-kind"
                        value={option}
                        checked={selected}
                        onChange={() => setKind(option)}
                        className="mt-0.5 size-4 shrink-0 accent-foreground"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {REWARD_KIND_LABELS[option]}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {REWARD_KIND_DESCRIPTIONS[option]}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium leading-none">What earns it</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {REWARD_MILESTONE_TYPES.map((option) => {
                const selected = milestoneType === option;
                return (
                  <label
                    key={option}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                      selected ? 'border-ring bg-muted/50' : 'hover:bg-muted/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="reward-milestone"
                      value={option}
                      checked={selected}
                      onChange={() => setMilestoneType(option)}
                      className="size-4 shrink-0 accent-foreground"
                    />
                    <span className="text-sm font-medium">{REWARD_MILESTONE_LABELS[option]}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <Input
                id="reward-milestone-value"
                type="number"
                min={1}
                max={maxMilestone}
                value={milestoneValue}
                onChange={(event) => setMilestoneValue(event.target.value)}
                placeholder={milestoneType === 'PERCENT_COMPLETE' ? '100' : '5'}
                className="w-24"
              />
              {/* The unit, not the field's name: "5" means nothing without it. */}
              <Label htmlFor="reward-milestone-value" className="text-muted-foreground">
                {REWARD_MILESTONE_UNITS[milestoneType]}
              </Label>
            </div>
            {!milestoneValid && milestoneValue.trim().length > 0 && (
              <p className="text-xs text-destructive">
                A whole number between 1 and {maxMilestone}.
              </p>
            )}
          </fieldset>

          {carriesCode && (
            <div className="grid gap-2">
              <Label htmlFor="reward-code-prefix">Code prefix</Label>
              <Input
                id="reward-code-prefix"
                value={codePrefix}
                onChange={(event) => setCodePrefix(event.target.value)}
                placeholder="SAVE"
                maxLength={16}
                className="font-mono uppercase"
              />
              {!prefixValid ? (
                <p className="text-xs text-destructive">
                  Two to sixteen letters, digits or dashes, or nothing at all.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Optional. Each member&apos;s code is generated with this in front of it.
                </p>
              )}
            </div>
          )}

          {kind === 'GIFT_CARD' && (
            <div className="grid gap-2">
              <Label htmlFor="reward-amount">Face value</Label>
              <div className="flex gap-2">
                <Input
                  id="reward-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="25.00"
                  className="flex-1"
                />
                <Input
                  aria-label="Currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  placeholder={DEFAULT_CURRENCY}
                  maxLength={3}
                  className="w-24 font-mono uppercase"
                />
              </div>
              {/* Entered in the currency's own unit and stored in cents, because
                  that is the unit a price is typed in and the one that cannot
                  drift when it is added up. */}
              <p className="text-xs text-muted-foreground">
                In the currency&apos;s own unit — 25.00 is stored as 2500. A three-letter code
                like {DEFAULT_CURRENCY}.
              </p>
              {!amountValid && (
                <p className="text-xs text-destructive">
                  {amountCents === undefined
                    ? 'An amount is required.'
                    : `At most ${MAX_AMOUNT_CENTS / 100} in the currency's own unit.`}
                </p>
              )}
              {!currencyValid && (
                <p className="text-xs text-destructive">A three-letter currency code is required.</p>
              )}
            </div>
          )}

          {kind === 'CUSTOM' && (
            <div className="grid gap-2">
              <Label htmlFor="reward-instructions">Instructions</Label>
              <Textarea
                id="reward-instructions"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="What to do to claim it — who to ask, and for what."
                rows={3}
                maxLength={MAX_INSTRUCTIONS_LENGTH}
              />
              {/* A custom reward has no code to redeem, so the instructions are
                  the whole of what the person who earned it is told. */}
              <p className="text-xs text-muted-foreground">
                {trimmedInstructions.length}/{MAX_INSTRUCTIONS_LENGTH} — required, because a
                custom reward is handed over by a person and this is what tells them what to do.
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="reward-grant-limit">How many there are</Label>
            <Input
              id="reward-grant-limit"
              type="number"
              min={1}
              value={grantLimit}
              onChange={(event) => setGrantLimit(event.target.value)}
              placeholder="As many as are earned"
              className="w-24"
            />
            {limitValid ? (
              <p className="text-xs text-muted-foreground">Leave empty for as many as are earned.</p>
            ) : (
              <p className="text-xs text-destructive">
                {reward && Number.isInteger(limitNumber) && limitNumber < reward.grantCount
                  ? `It cannot be fewer than the ${reward.grantCount} already granted.`
                  : `A whole number between 1 and ${MAX_GRANT_LIMIT}.`}
              </p>
            )}
          </div>

          {reward && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted/40">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-foreground"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Offered</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  A paused reward stops being earned and stops being handed out, and everybody who
                  already holds it keeps it.
                </span>
              </span>
            </label>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {pending && <Loader2Icon className="animate-spin" />}
              {reward ? 'Save' : 'Add reward'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
