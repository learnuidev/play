import type { AuthUser } from './auth';
import type { OrgMember, OrgRole } from '../types';

/**
 * A membership as the API hands it out.
 *
 * The stored row is never returned as-is: an `INVITED` row is keyed by an email
 * address that is only there as a placeholder for a `sub` that does not exist
 * yet, and an email address is exactly what a client should not be told to use
 * as an identifier. The shape below says which kind of row this is instead.
 */
export interface ApiMember {
  /** Cognito `sub` of the member, or the invited address while `pending`. */
  userId: string;
  role: OrgRole;
  /** True while the invitation has not been accepted: the role is not in force. */
  pending: boolean;
  /**
   * The address this membership is for. Hidden from non-admins — a roster is
   * for knowing who is in the organization, and an email address is not needed
   * for that by someone who cannot act on it.
   */
  email?: string;
  /** Whether this row is the caller's own. */
  isYou: boolean;
  /** Whether the caller is the one who can accept it. */
  isInvitationForYou: boolean;
  /** Cognito `sub` of whoever added them, when known. */
  invitedBy?: string;
  joinedAt: number;
}

/**
 * Presents a membership to the caller.
 *
 * An invitation is addressed to an address rather than to a `sub`, so the
 * caller claims one by being signed in as that address — which is knowable
 * without a lookup, from the claims the authorizer already put on the request.
 */
export function toApiMember(member: OrgMember, viewer: AuthUser, includeEmail: boolean): ApiMember {
  const pending = member.status === 'INVITED';
  const invitedEmail = member.invitedEmail?.toLowerCase();

  return {
    userId: member.userId,
    role: member.role,
    pending,
    ...(includeEmail && member.email ? { email: member.email } : {}),
    isYou: !pending && member.userId === viewer.userId,
    isInvitationForYou: pending && Boolean(invitedEmail) && invitedEmail === viewer.email?.toLowerCase(),
    ...(member.invitedBy ? { invitedBy: member.invitedBy } : {}),
    joinedAt: member.joinedAt,
  };
}

/**
 * Normalizes an email address the way memberships are keyed by it.
 *
 * An invitation is addressed to an address, so the address *is* the key: two
 * spellings of the same mailbox would be two invitations, one of which the
 * person could never claim. Lower-casing the domain is safe; the local part is
 * case-sensitive by the letter of the standard and case-insensitive in the
 * practice of every provider anybody uses, so it is lower-cased too — matching
 * what Cognito's own email alias handling does.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether a string is an address we are willing to send an invitation to.
 *
 * Deliberately loose: the real check is whether Cognito will accept the address
 * at sign-up, and a stricter pattern here would only reject valid addresses.
 * One `@`, something either side, a dot in the domain, no whitespace.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
