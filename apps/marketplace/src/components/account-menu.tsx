'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthenticator } from '@aws-amplify/ui-react';
import {
  BookOpenIcon,
  CreditCardIcon,
  HeartIcon,
  LogOutIcon,
  ReceiptTextIcon,
  UserRoundIcon,
} from 'lucide-react';
import { useMyProfile } from '@api/modules/profile/profile.queries';
import { PersonAvatar } from '@play/ui';
import { Button } from '@ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';

/**
 * The signed-in reader's account menu.
 *
 * Two groups, and the split is the point: what they are *taking* — the courses
 * they are in, the lessons they kept — and then the account itself, which is
 * about the person rather than about a course. The marketplace has no
 * organizations to navigate: who runs a course is not the reader's business.
 *
 * The header is their **name and photo**, not their address. An address is what
 * a password reset asks for, and printing it over a menu on every page of a
 * reading app tells a person nothing they do not know — while the name and the
 * face are what the rest of the product shows beside anything they say.
 */
export function AccountMenu() {
  const router = useRouter();
  const { user, signOut } = useAuthenticator((context) => [context.user, context.signOut]);
  const email = user?.signInDetails?.loginId ?? user?.username ?? '';

  /**
   * Read here rather than only on the account screen, for the reason the studio
   * reads it in its own menu: this is what brings the row into being and names
   * the account, and the trigger is then drawn as the person rather than as a
   * silhouette. One read, cached, shared with the profile screen underneath it.
   */
  const { data } = useMyProfile();
  const profile = data?.profile;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 p-0" aria-label="Account">
          {profile ? (
            <PersonAvatar
              name={profile.name}
              photoUrl={profile.photoUrl}
              size="sm"
              className="border-0 bg-transparent"
            />
          ) : (
            <UserRoundIcon />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">
          {/* `||` rather than `??`: `email` is the empty string when the session
              has no address on it, and an empty menu header is worse than the
              fallback. The profile's name is preferred because it is the one the
              rest of the product shows. */}
          <span className="block truncate text-sm font-medium">
            {profile?.name || email || 'Your account'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/my-courses">
            <BookOpenIcon />
            My learning
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/favourites">
            <HeartIcon />
            Favourites
          </Link>
        </DropdownMenuItem>

        {/* The account, as one group: who you are, what you pay with, and what
            you have paid for. Three links rather than a submenu — a dropdown
            inside a dropdown is a menu somebody has to aim at. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/profile">
            <UserRoundIcon />
            My profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/payment-cards">
            <CreditCardIcon />
            Payment cards
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/billing-history">
            <ReceiptTextIcon />
            Billing history
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            router.push('/');
          }}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
