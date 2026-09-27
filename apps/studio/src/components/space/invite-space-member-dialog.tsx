'use client';

import { useState, type ReactNode } from 'react';
import { LinkIcon, Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_ROLE_DESCRIPTIONS,
  SPACE_MEMBER_ROLE_LABELS,
  type InviteSpaceMemberResponse,
  type SpaceMemberRole,
} from '@/types';
import { useInviteSpaceMember } from '@/modules/space-member/space-member.queries';
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

/**
 * The same loose check the API makes, so an obvious typo fails without a round
 * trip. Whether the address exists at all is Cognito's answer at sign-up.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Invites somebody to a course by email address.
 *
 * The person does not have to be in the organization, and does not have to have
 * an account: the invitation names an address, and whoever can sign in as it
 * claims the course from its own page. That is what makes a course shareable
 * with a guest rather than only with colleagues.
 */
export function InviteSpaceMemberDialog({
  spaceId,
  trigger,
}: {
  spaceId: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SpaceMemberRole>('STUDENT');
  const [result, setResult] = useState<InviteSpaceMemberResponse | null>(null);

  const invite = useInviteSpaceMember(spaceId);

  const trimmedEmail = email.trim();
  const emailInvalid = trimmedEmail.length > 0 && !EMAIL_PATTERN.test(trimmedEmail);
  const canSubmit = EMAIL_PATTERN.test(trimmedEmail) && !invite.isPending;

  function reset() {
    setResult(null);
    setEmail('');
    setRole('STUDENT');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    try {
      const response = await invite.mutateAsync({ email: trimmedEmail, role });
      setResult(response);

      // Only claim it was emailed when it was: a deployment with no verified
      // sender still writes a real invitation, and saying "invited" there is how
      // somebody ends up waiting for a message that never went out.
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
          <DialogTitle>Invite someone to this course</DialogTitle>
          <DialogDescription>
            They do not need an account, or to be in your organization. The invitation waits for
            whoever signs in with this address.
          </DialogDescription>
        </DialogHeader>

        {result && !result.delivery.sent ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
              <p className="text-sm font-medium">The invitation exists — the email did not go out</p>
              <p className="text-xs text-muted-foreground">{result.delivery.error}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="course-invite-link">Send them this link instead</Label>
              <div className="flex gap-2">
                <Input
                  id="course-invite-link"
                  readOnly
                  value={result.inviteUrl}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copyLink(result.inviteUrl)}
                >
                  <LinkIcon />
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                They sign in with {result.member.email ?? trimmedEmail} and accept from the course
                page. The Members tab shows this link again whenever it is needed.
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
              <Label htmlFor="course-invite-email">Email address</Label>
              <Input
                id="course-invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="student@example.com"
                autoComplete="off"
                autoFocus
              />
              {emailInvalid && (
                <p className="text-xs text-destructive">That does not look like an email address.</p>
              )}
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium leading-none">What they are here</legend>
              <div className="grid gap-2">
                {SPACE_MEMBER_ROLES.map((option) => {
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
                        name="course-member-role"
                        value={option}
                        checked={selected}
                        onChange={() => setRole(option)}
                        className="mt-0.5 size-4 shrink-0 accent-foreground"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {SPACE_MEMBER_ROLE_LABELS[option]}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {SPACE_MEMBER_ROLE_DESCRIPTIONS[option]}
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
