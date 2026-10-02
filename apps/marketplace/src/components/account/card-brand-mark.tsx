'use client';

import { cn } from '@play/ui';

/**
 * A card's brand, as a mark rather than a word.
 *
 * A wallet is read by shape: somebody looking for "the visa" is looking for two
 * circles or a blue wordmark, not for the string `mastercard` set in the same
 * type as the last four digits beside it. The name is still there for a screen
 * reader, in `title` and in the visually hidden text — a mark this small is not
 * something to make somebody guess at.
 *
 * ## These are drawn, not copied
 *
 * Official brand art is licensed per brand and arrives as a file per brand; what
 * is here is each mark's *recognizable* form redrawn in a few shapes — the two
 * interlocking circles, the blue wordmark, three coloured blocks — which is what
 * these marks are at 32 pixels wide. An unknown brand gets a plain card glyph
 * rather than a guess, because a wallet that draws somebody's Amex as a generic
 * rectangle is telling them something untrue about their own card.
 */
export function CardBrandMark({ brand, className }: { brand: string; className?: string }) {
  const known = MARK[brand];

  return (
    <span
      title={brandName(brand)}
      className={cn(
        'flex h-8 w-12 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/80',
        className,
      )}
    >
      <span className="sr-only">{brandName(brand)}</span>
      {known ?? <Fallback />}
    </span>
  );
}

/** Visa: the wordmark, italic and in the brand blue. */
function Visa() {
  return (
    <svg viewBox="0 0 48 20" className="h-4 w-10" aria-hidden>
      <text
        x="24"
        y="15.5"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="15"
        fontStyle="italic"
        fontWeight="700"
        letterSpacing="0.4"
        fill="#1A1F71"
      >
        VISA
      </text>
    </svg>
  );
}

/** Mastercard: two overlapping circles, which is the whole of the mark. */
function Mastercard() {
  return (
    <svg viewBox="0 0 48 24" className="h-5 w-10" aria-hidden>
      <circle cx="19" cy="12" r="9" fill="#EB001B" />
      <circle cx="29" cy="12" r="9" fill="#F79E1B" />
      <path
        d="M24 5.2a9 9 0 0 0 0 13.6 9 9 0 0 0 0-13.6Z"
        fill="#FF5F00"
      />
    </svg>
  );
}

/** American Express: a blue box with the name in it. */
function Amex() {
  return (
    <svg viewBox="0 0 48 24" className="h-5 w-10" aria-hidden>
      <rect x="6" y="1" width="36" height="22" rx="3" fill="#2E77BC" />
      <text
        x="24"
        y="16"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="8"
        fontWeight="700"
        fill="#ffffff"
      >
        AMEX
      </text>
    </svg>
  );
}

/** Discover: the wordmark with its orange disc. */
function Discover() {
  return (
    <svg viewBox="0 0 48 20" className="h-4 w-10" aria-hidden>
      <text
        x="22"
        y="14"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="7"
        fontWeight="700"
        fill="#231F20"
      >
        DISCOVER
      </text>
      <circle cx="43" cy="10" r="4" fill="#F27712" />
    </svg>
  );
}

/** JCB: three coloured blocks, which is what the mark is. */
function Jcb() {
  return (
    <svg viewBox="0 0 48 24" className="h-5 w-10" aria-hidden>
      <rect x="8" y="1" width="10" height="22" rx="2" fill="#0E4C96" />
      <rect x="19" y="1" width="10" height="22" rx="2" fill="#E10B17" />
      <rect x="30" y="1" width="10" height="22" rx="2" fill="#00A650" />
    </svg>
  );
}

/** A card, for a brand this screen has no mark for. */
function Fallback() {
  return (
    <svg viewBox="0 0 48 24" className="h-4 w-9 text-muted-foreground" aria-hidden>
      <rect
        x="4"
        y="2"
        width="40"
        height="20"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line x1="4" y1="9" x2="44" y2="9" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const MARK: Record<string, React.ReactNode> = {
  visa: <Visa />,
  mastercard: <Mastercard />,
  amex: <Amex />,
  discover: <Discover />,
  jcb: <Jcb />,
};

/**
 * A brand as a person writes it.
 *
 * Stripe answers in its own vocabulary — `visa`, `mastercard`, `amex` — and the
 * abbreviations are the part worth expanding, because a card is recognized by
 * the word on it. An unknown brand is left as Stripe sent it rather than guessed
 * at: a card this screen has not seen before should read oddly, not wrongly.
 */
export function brandName(brand: string): string {
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
