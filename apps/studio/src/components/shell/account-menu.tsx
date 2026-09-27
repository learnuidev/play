'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';
import Link from 'next/link';
import {
  BuildingIcon,
  GraduationCapIcon,
  LogOutIcon,
  MailPlusIcon,
  UserIcon,
} from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';

/** The signed-in user's account menu in the top bar. */
export function AccountMenu() {
  const { user, signOut } = useAuthenticator((context) => [context.user, context.signOut]);
  const email = user?.signInDetails?.loginId ?? user?.username ?? '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Account">
          <UserIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">
          <span className="block text-xs text-muted-foreground">Signed in as</span>
          <span className="block truncate text-sm font-medium">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* The courses you can open, across every organization. Here rather than
            in the community rail because it is not about the community you are
            in: a course can be taken by somebody who belongs to none. */}
        <DropdownMenuItem asChild>
          <Link href="/spaces">
            <GraduationCapIcon />
            Your spaces
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/invites">
            <MailPlusIcon />
            Invitations
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/organizations">
            <BuildingIcon />
            Your organizations
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
