import type { SpaceMemberApi } from '@play/types';

/**
 * Who a course's member row is about, and the address that goes beside it.
 *
 * The rule used to live in five screens with five slightly different answers —
 * the roster preferred the profile name and showed no address at all, the
 * instructor card preferred the name and put the address underneath, the two
 * pickers preferred the *address* and never showed the name, and the cohort
 * dialog showed only the address. Nobody decided any of that; each screen was
 * written on its own afternoon. A roster is read to answer one question — who is
 * this, and how do I reach them — and the two halves of that answer belong in one
 * place so that every list of members answers it the same way.
 *
 * ## Why there is no permission check here
 *
 * Because the API already made it: `toApiSpaceMember` sends `email` only to
 * somebody who may manage the roster, and to the person an outstanding invitation
 * names. A viewer of the organization, and a student reading their own course,
 * get rows with no address on them — so `spaceMemberEmail` returns null and the
 * screens simply draw nothing. A second check in the UI would be a rule written
 * twice, and the copy that drifts is always the one in the browser.
 */

/**
 * What to call somebody on a roster row.
 *
 * The name first, because it is the one thing on a member that a person chose and
 * the only thing that reads as a person rather than as a record. Then the address,
 * which is what an invitation with no account behind it has instead of a name.
 * Then the tail of the id, which is enough to tell two otherwise-identical rows
 * apart without pretending to be either of the other two.
 */
export function spaceMemberName(member: SpaceMemberApi): string {
  if (member.isYou) return 'You';
  if (member.name) return member.name;
  if (member.email) return member.email;
  return `Member ${member.userId.slice(0, 6)}`;
}

/**
 * The address to show *beside* that name, or null.
 *
 * Null when the address is already the name — a pending invitation, or a member
 * who has not filled in a profile — because a row that said `ada@example.com` and
 * then `ada@example.com` again would read as two different facts.
 *
 * It is shown rather than hidden behind a menu for the reason the instructors
 * card has always given: two accounts of one person are told apart by the address
 * and by nothing else, and an author who assigns the wrong one sees their own
 * name missing from a course they teach with nothing on screen to explain it.
 */
export function spaceMemberEmail(member: SpaceMemberApi): string | null {
  if (!member.email) return null;
  return member.email === spaceMemberName(member) ? null : member.email;
}
