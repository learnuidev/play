'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@play/ui';

/**
 * The three account screens, as one segmented control.
 *
 * A segmented control rather than underlined links, because that is what a strip
 * of tabs is everywhere else in this product — the studio's section bar and a
 * course's own tabs are the same track with the active item lifted out.
 *
 * The order is the order of the questions a person arrives with: who they are,
 * what they pay with, what they have paid. The profile is first because it is
 * the only one of the three that is about them rather than about their money.
 */
const TABS = [
  { href: '/account/profile', label: 'Profile' },
  { href: '/account/payment-cards', label: 'Payment cards' },
  { href: '/account/billing-history', label: 'Billing history' },
] as const;

export function AccountTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Account sections"
      className="inline-flex items-center gap-1 rounded-full bg-muted/70 p-1"
    >
      {TABS.map((tab) => {
        // `startsWith` rather than equality so a screen nested under one of
        // these — a receipt, if one ever gets its own page — keeps its tab lit.
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
