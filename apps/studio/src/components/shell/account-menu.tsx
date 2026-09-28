'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';
import Link from 'next/link';
import {
  BookOpenIcon,
  BuildingIcon,
  GraduationCapIcon,
  KeyRoundIcon,
  Link2Icon,
  LogOutIcon,
  MailPlusIcon,
  SquareCodeIcon,
  UserRoundIcon,
} from 'lucide-react';
import { useMyProfile } from '@api/modules/profile/profile.queries';
import { Button } from '@ui/components/ui/button';
import { PersonAvatar } from '@play/ui';
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

  /**
   * The profile is read here rather than only on its own page, and that is the
   * point of reading it at all: an account is named the first time it is seen,
   * and this menu is rendered by every shell in the app. A person's name is then
   * correct on the screens *other* people read — a course they teach, a roster —
   * from the first time they open the studio, without their having to know that
   * a profile screen exists.
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
          <span className="block text-xs text-muted-foreground">Signed in as</span>
          <span className="block truncate text-sm font-medium">{profile?.name ?? email}</span>
          {profile && <span className="block truncate text-xs text-muted-foreground">{email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* The person, before the things they belong to: a name and a photo are
            what the marketplace credits their courses to. */}
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRoundIcon />
            Profile
          </Link>
        </DropdownMenuItem>
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
        {/* The four developer surfaces. Here rather than in a sidebar section
            because none of them belongs to a community: a key and an app are the
            person's own, a connection is what somebody else's app was allowed to
            do, and the reference is what all three are read against. They are the
            same four screens whether somebody is in one organization or none.

            Keys before apps, and apps before connections, because that is the
            order of the questions: do I need a credential, am I building a
            client, and what have I already let in. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/api-keys">
            <KeyRoundIcon />
            API keys
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/oauth/apps">
            <SquareCodeIcon />
            OAuth apps
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/oauth/connections">
            <Link2Icon />
            Connected apps
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/docs">
            <BookOpenIcon />
            API reference
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
