import { HttpError } from './http';
import { REWARD_KINDS, REWARD_MILESTONE_TYPES } from '../types';
import type { RewardKind, RewardMilestone, RewardMilestoneType } from '../types';

/**
 * A reward's fields, validated in one place.
 *
 * The create and edit routes write the same eight fields, and a coupon that a
 * checkout could never take must be refused the same way on both. What each kind
 * requires is the interesting part: a gift card with no amount is not a gift
 * card, and a custom reward with nothing to do is not an instruction.
 */

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_INSTRUCTIONS_LENGTH = 1000;
const MAX_AMOUNT_CENTS = 100_000_000;

/** ISO-4217, as far as this API cares: three letters. */
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

/** A code prefix is read by a human and typed into a checkout. */
const PREFIX_PATTERN = /^[A-Za-z0-9-]{2,16}$/;

export function parseRewardName(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'name is required');

  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < MIN_NAME_LENGTH) {
    throw new HttpError(400, `name must be at least ${MIN_NAME_LENGTH} characters`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `name must be <= ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

export function parseRewardDescription(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new HttpError(400, 'description must be a string');

  const description = raw.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(400, `description must be <= ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  return description;
}

export function parseRewardKind(raw: unknown): RewardKind {
  if (typeof raw !== 'string' || !REWARD_KINDS.includes(raw as RewardKind)) {
    throw new HttpError(400, `kind must be one of ${REWARD_KINDS.join(', ')}`);
  }
  return raw as RewardKind;
}

/**
 * A milestone: what has to happen, and how much of it.
 *
 * Bounds are by kind, because "complete 150% of a course" is not a hard target,
 * it is a typo — and a target of zero would hand the reward to everybody the
 * moment the course was opened.
 */
export function parseMilestone(raw: unknown): RewardMilestone {
  if (typeof raw !== 'object' || raw === null) throw new HttpError(400, 'milestone is required');

  const { type, value } = raw as { type?: unknown; value?: unknown };
  if (typeof type !== 'string' || !REWARD_MILESTONE_TYPES.includes(type as RewardMilestoneType)) {
    throw new HttpError(400, `milestone.type must be one of ${REWARD_MILESTONE_TYPES.join(', ')}`);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new HttpError(400, 'milestone.value must be a whole number');
  }

  const max = type === 'PERCENT_COMPLETE' ? 100 : 10_000;
  if (value < 1 || value > max) {
    throw new HttpError(400, `milestone.value must be between 1 and ${max}`);
  }

  return { type: type as RewardMilestoneType, value };
}

/** A gift card's face value, in cents, as a positive whole number. */
export function parseAmountCents(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_AMOUNT_CENTS) {
    throw new HttpError(400, `amountCents must be a whole number of cents between 1 and ${MAX_AMOUNT_CENTS}`);
  }
  return raw;
}

export function parseCurrency(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !CURRENCY_PATTERN.test(raw.trim())) {
    throw new HttpError(400, 'currency must be a three-letter code like USD');
  }
  return raw.trim().toUpperCase();
}

export function parseCodePrefix(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !PREFIX_PATTERN.test(raw.trim())) {
    throw new HttpError(400, 'codePrefix must be 2–16 letters, digits or dashes');
  }
  return raw.trim().toUpperCase();
}

export function parseInstructions(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') throw new HttpError(400, 'instructions must be a string');

  const instructions = raw.trim();
  if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    throw new HttpError(400, `instructions must be <= ${MAX_INSTRUCTIONS_LENGTH} characters`);
  }
  return instructions;
}

/** How many may ever be granted. Absent means as many as are earned. */
export function parseGrantLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 1_000_000) {
    throw new HttpError(400, 'grantLimit must be a whole number between 1 and 1000000');
  }
  return raw;
}

/**
 * Whether what a reward says adds up.
 *
 * Checked across fields rather than one at a time, because the combination is
 * what makes it a reward: a coupon with no prefix still has a generated code, a
 * gift card needs an amount, and a custom reward needs something to tell the
 * person who earned it what to do about it.
 */
export function assertRewardShape(input: {
  kind: RewardKind;
  amountCents?: number;
  currency?: string;
  instructions?: string;
}): void {
  if (input.kind === 'GIFT_CARD') {
    if (input.amountCents === undefined) {
      throw new HttpError(400, 'A gift card needs an amountCents value');
    }
    if (!input.currency) throw new HttpError(400, 'A gift card needs a currency');
  }

  if (input.kind === 'CUSTOM' && !input.instructions) {
    throw new HttpError(400, 'A custom reward needs instructions for whoever hands it over');
  }
}
