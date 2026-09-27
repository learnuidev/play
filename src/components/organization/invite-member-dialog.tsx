'use client';

import { useState, type ReactNode } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { ORG_ROLES, ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS, type OrgRole } from '@/types';
import { useInviteMember } from '@/modules/organization/member.queries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The same loose check the API makes, so an obvious typo fails without a round
 * trip. Whether the address exists at all is Cognito's answer at sign-up, not
 * this form's.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Invites somebody to the organization by email address, with the role they
 * will hold once they accept.
 *
 * The person does not have to have an account: the invitation names an address,
 * and whoever can sign in as it claims the offer from this page.
 */
export function InviteMemberDialog({ orgId, trigger }: { orgId: string; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('EDITOR');

  const invite = useInviteMember(orgId);

  const trimmedEmail = email.trim();
  const emailInvalid = trimmedEmail.length > 0 && !EMAIL_PATTERN.test(trimmedEmail);
  const canSubmit = EMAIL_PATTERN.test(trimmedEmail) && !invite.isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    try {
      await invite.mutateAsync({ email: trimmedEmail, role });
      toast.success(`Invited ${trimmedEmail} as ${ORG_ROLE_LABELS[role].toLowerCase()}`);
      setOpen(false);
      setEmail('');
      setRole('EDITOR');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the invitation');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            They do not need an account yet. The invitation waits for whoever signs in with this
            address.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              autoComplete="off"
              autoFocus
            />
            {emailInvalid && (
              <p className="text-xs text-destructive">That does not look like an email address.</p>
            )}
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium leading-none">Role</legend>
            <div className="grid gap-2">
              {ORG_ROLES.map((option) => {
                const selected = role === option;
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
                      name="member-role"
                      value={option}
                      checked={selected}
                      onChange={() => setRole(option)}
                      className="mt-0.5 size-4 shrink-0 accent-foreground"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{ORG_ROLE_LABELS[option]}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {ORG_ROLE_DESCRIPTIONS[option]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {invite.isPending && <Loader2Icon className="animate-spin" />}
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
