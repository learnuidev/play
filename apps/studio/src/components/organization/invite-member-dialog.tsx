'use client';

import { useState, type ReactNode } from 'react';
import { LinkIcon, Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import {
  ORG_ROLES,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  type InviteMemberResponse,
  type OrgRole,
} from '@play/types';
import { useInviteMember } from '@api/modules/organization/member.queries';
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
import { cn } from '@ui/lib/utils';

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
  const [result, setResult] = useState<InviteMemberResponse | null>(null);

  const invite = useInviteMember(orgId);

  const trimmedEmail = email.trim();
  const emailInvalid = trimmedEmail.length > 0 && !EMAIL_PATTERN.test(trimmedEmail);
  const canSubmit = EMAIL_PATTERN.test(trimmedEmail) && !invite.isPending;

  function reset() {
    setResult(null);
    setEmail('');
    setRole('EDITOR');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    try {
      const response = await invite.mutateAsync({ email: trimmedEmail, role });
      setResult(response);

      // Only claim it was emailed when it was. A deployment with no verified
      // sender, or an account still in the SES sandbox, produces a real
      // invitation and no email at all — saying "invited" there is how an admin
      // ends up waiting for a message that was never sent.
      if (response.delivery.sent) {
        toast.success(`Invitation emailed to ${trimmedEmail}`);
        setOpen(false);
        reset();
      } else {
        toast.warning('Invitation created, but no email was sent', {
          description: response.delivery.error,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the invitation');
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invitation link copied');
    } catch {
      toast.error('Could not copy the link', { description: url });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            They do not need an account yet. The invitation waits for whoever signs in with this
            address.
          </DialogDescription>
        </DialogHeader>

        {result && !result.delivery.sent ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
              <p className="text-sm font-medium">The invitation exists — the email did not go out</p>
              <p className="text-xs text-muted-foreground">{result.delivery.error}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invite-link">Send them this link instead</Label>
              <div className="flex gap-2">
                <Input id="invite-link" readOnly value={result.inviteUrl} className="font-mono" />
                <Button type="button" variant="secondary" onClick={() => void copyLink(result.inviteUrl)}>
                  <LinkIcon />
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                They sign in with {result.member.email ?? trimmedEmail} and accept from the
                organizations page. The Members tab shows this link again whenever it is needed.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={reset}>
                Invite somebody else
              </Button>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
