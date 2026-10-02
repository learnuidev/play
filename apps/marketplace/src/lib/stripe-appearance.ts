'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Appearance } from '@stripe/stripe-js';

/**
 * How the marketplace draws a Stripe Element.
 *
 * ## One appearance, because there are two forms
 *
 * A card form and a checkout form both hand fields to Stripe, and an Element is
 * an **iframe**: it inherits nothing from the page around it — not the font, not
 * the radius, not one colour — so everything it draws with has to be said
 * through the appearance API. Said twice, the two say different things: the
 * first version of the card form left the colours to inheritance, and the digits
 * came out black inside a dark card, which is a number nobody can read. So the
 * two screens share this file rather than an object each.
 *
 * ## Why the theme is read from the document
 *
 * Not from `next-themes`, which is what the card form asked first and what got
 * it wrong: which theme a library remembers is not the question. The question is
 * what colour the page around the field actually *is*, and that is the `dark`
 * class on `<html>` — so a `MutationObserver` on that class is how the toggle
 * reaches a field Stripe draws. It redraws when the appearance changes, which is
 * what makes the digits follow the switch.
 *
 * ## And where a course's colour comes in
 *
 * A course is drawn in its own colour everywhere else in this product, and the
 * checkout is where a stranger decides to trust it — so the accent is passed in
 * and becomes the Element's **primary**: the wallet button, the selected tab,
 * the links inside the form. It is the one place a brand can reach inside an
 * iframe, and the ink on it is chosen from the colour rather than assumed — see
 * `accentInk`.
 */
export function useElementsAppearance(accent?: string): Appearance {
  const dark = useDarkDocument();

  return useMemo(
    () => ({
      theme: dark ? 'night' : 'stripe',
      variables: {
        borderRadius: '12px',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSizeBase: '14px',
        // Spelled out for the reason above: an Element is an iframe and inherits
        // nothing, so every colour it draws with has to be given to it.
        colorText: dark ? '#f8fafc' : '#0f172a',
        colorTextSecondary: dark ? '#94a3b8' : '#64748b',
        colorTextPlaceholder: dark ? '#94a3b8' : '#64748b',
        colorDanger: '#f87171',
        colorBackground: dark ? '#0b0b0c' : '#ffffff',
        ...(accent ? { colorPrimary: accent, colorPrimaryText: accentInk(accent) } : {}),
      },
    }),
    [dark, accent],
  );
}

/**
 * Whether the page is dark — read from the document, not from the theme library.
 *
 * Exported beside the appearance rather than kept in a component, because the
 * checkout draws its own brand chrome and has the same question to ask: what
 * colour is this page, right now.
 */
export function useDarkDocument(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const read = () => setDark(document.documentElement.classList.contains('dark'));
    read();

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

/**
 * The ink a colour can carry: white, or the near-black the product writes in.
 *
 * A course's colour identifies the course; it was not chosen to have words on
 * it. `#f59e0b` is a perfectly good accent and a white-on-amber button nobody
 * can read, so the digits are picked from the colour's own brightness instead of
 * fixed — the one thing a payment button cannot do is draw a word nobody can
 * see.
 *
 * The relative luminance is WCAG's, and the threshold is **above** the point
 * where black and white are equally readable (about 0.18). That is deliberate:
 * the deep colours in `SPACE_COLORS` — indigo, violet, pink — sit right at the
 * crossover, and white is how this product draws them everywhere else, so they
 * keep it. Only the genuinely light ones — orange, amber, teal, sky — flip.
 */
export function accentInk(accent: string): string {
  return luminanceOf(accent) > 0.3 ? '#0f172a' : '#ffffff';
}

/** WCAG relative luminance: 0 is black, 1 is white. */
function luminanceOf(color: string): number {
  const [r, g, b] = channelsOf(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The three channels of a hex colour, linearised. */
function channelsOf(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex;

  const value = Number.parseInt(full, 16);
  // A colour that is not a hex at all — a name, or something hand-written into a
  // course's row — reads as black: white on it is the safe half of the guess,
  // and `SPACE_COLORS` is the only thing the product itself ever writes here.
  if (!Number.isFinite(value)) return [0, 0, 0];

  return [linear((value >> 16) & 255), linear((value >> 8) & 255), linear(value & 255)];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
