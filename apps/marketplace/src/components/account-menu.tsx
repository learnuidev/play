'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { BookOpenIcon, LogOutIcon } from 'lucide-react';
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
 * The signed-in reader's avatar menu.
 *
 * Two things, and both are about them rather than about a community: the courses
 * they are taking, and signing out. The marketplace has no organizations to
 * navigate — who runs a course is not the reader's business.
 */
export function AccountMenu() {
  const router = useRouter();
  const { user, signOut } = useAuthenticator((context) => [context.user, context.signOut]);
  const email = user?.signInDetails?.loginId ?? user?.username ?? '';
  const initial = email.trim()[0]?.toUpperCase() ?? '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-600/90 hover:text-white"
          aria-label="Account"
        >
          {initial}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">
          <span className="block text-xs text-muted-foreground">Signed in as</span>
          <span className="block truncate text-sm font-medium">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/my-courses">
            <BookOpenIcon />
            My learning
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
