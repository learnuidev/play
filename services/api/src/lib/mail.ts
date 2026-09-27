import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { env } from './config';
import type { MailDelivery } from './members';
import type { OrgRole, SpaceMemberRole } from '../types';

/**
 * Sends the invitation emails.
 *
 * Delivery is kept apart from the invitation for one reason: inviting somebody
 * and telling them are two things that fail separately. The invitation row *is*
 * the offer and it is already written by the time this runs, so a send that
 * fails must not fail the invite — it is reported back to the admin, who still
 * has the link to pass on by hand. That is why nothing here throws.
 */
const client = new SESv2Client({});

/** Whether this deployment can send mail at all. */
export function mailConfigured(): boolean {
  return Boolean(env.mailFromAddress);
}

export interface SendInvitationEmailInput {
  /** Address the invitation names. */
  to: string;
  /** Organization the invitation is for. */
  organizationName: string;
  /** Role they were invited with. Rendered by lower-casing, as the rest of
   *  the API does (`src/lib/access.ts`). */
  role: OrgRole;
  /** Who sent it. A `sub` when the inviter has no name or email to show. */
  invitedBy: string;
  /** Where the recipient claims it, signed in as `to`. */
  inviteUrl: string;
}

/**
 * Escapes text interpolated into the HTML part.
 *
 * Every value here is somebody's own words — an organization name, a person's
 * name — and a name with an angle bracket in it must not become markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function subjectFor(input: SendInvitationEmailInput): string {
  return `${input.invitedBy} invited you to ${input.organizationName} on Play`;
}

/** The plain-text part: sent alongside the HTML, and what a text client reads. */
function textBody(input: SendInvitationEmailInput): string {
  return [
    `${input.invitedBy} invited you to join ${input.organizationName} on Play as ${input.role.toLowerCase()}.`,
    '',
    `Open this link and sign in with ${input.to} to accept:`,
    input.inviteUrl,
    '',
    'Nothing in the organization is visible to you until you accept.',
    'If you were not expecting this, you can ignore this email.',
  ].join('\n');
}

/**
 * The HTML part: one column, inline styles, no images and no tracking.
 *
 * Mail clients strip stylesheets and block remote images, so the layout is
 * carried entirely by the markup — which is also the honest shape for something
 * whose whole job is one sentence and one link.
 */
function htmlBody(input: SendInvitationEmailInput): string {
  const org = escapeHtml(input.organizationName);
  const inviter = escapeHtml(input.invitedBy);
  const role = escapeHtml(input.role.toLowerCase());
  const url = escapeHtml(input.inviteUrl);
  const to = escapeHtml(input.to);

  return `<div style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:32px">
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6">${inviter} invited you to join</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${org}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#52525b">
      You have been invited as <strong>${role}</strong>.
    </p>
    <a href="${url}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600">Accept invitation</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a">
      Sign in with <strong>${to}</strong> — that is the address the invitation was sent to.
      Nothing in the organization is visible to you until you accept.
    </p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#a1a1aa">
      If you were not expecting this, you can ignore this email.
    </p>
  </div>
</div>`;
}

/**
 * Sends one invitation. Never throws: the caller has an invitation to report on
 * either way, and a delivery failure is information for the admin rather than a
 * reason to unwind the invite.
 */
export async function sendInvitationEmail(input: SendInvitationEmailInput): Promise<MailDelivery> {
  if (!mailConfigured()) {
    return {
      sent: false,
      error: 'No sending address is configured for this deployment, so nothing was emailed.',
    };
  }

  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: env.mailFromAddress,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: subjectFor(input), Charset: 'UTF-8' },
            Body: {
              Text: { Data: textBody(input), Charset: 'UTF-8' },
              Html: { Data: htmlBody(input), Charset: 'UTF-8' },
            },
          },
        },
      }),
    );

    return { sent: true, from: env.mailFromAddress };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    const message = err instanceof Error ? err.message : String(err);
    console.error('Invitation email failed', { to: input.to, name, message });

    return {
      sent: false,
      from: env.mailFromAddress,
      // The SDK's own words, because the two failures an admin actually hits
      // are named precisely by it: `MessageRejected` ("Email address is not
      // verified. The following identities failed the check…") while the
      // account is in the SES sandbox, and `AccessDenied` when the deployment
      // was never granted `ses:SendEmail`.
      error: `${name}: ${message}`,
    };
  }
}

export interface SendSpaceInvitationEmailInput {
  /** Address the invitation names. */
  to: string;
  /** Course the invitation is for. */
  spaceTitle: string;
  /** Organization the course belongs to, named so the offer has a context. */
  organizationName: string;
  /** Role they were invited with. */
  role: SpaceMemberRole;
  /** Who sent it. */
  invitedBy: string;
  /** Where the recipient claims it, signed in as `to`. */
  inviteUrl: string;
}

/**
 * Sends a course invitation.
 *
 * Deliberately a second letter rather than a parameter on the first: an
 * organization invitation is an offer to join the organization, and a course
 * invitation is an offer to take one course — possibly from outside it. Saying
 * "you have been invited to join Acme Learning" to somebody who will only ever
 * see one course would be a promise the acceptance does not keep.
 */
export async function sendSpaceInvitationEmail(
  input: SendSpaceInvitationEmailInput,
): Promise<MailDelivery> {
  if (!mailConfigured()) {
    return {
      sent: false,
      error: 'No sending address is configured for this deployment, so nothing was emailed.',
    };
  }

  const subject = `${input.invitedBy} invited you to ${input.spaceTitle} on Play`;
  const role = input.role.toLowerCase();

  const text = [
    `${input.invitedBy} invited you to take ${input.spaceTitle} on Play as ${role}.`,
    '',
    `Open this link and sign in with ${input.to} to accept:`,
    input.inviteUrl,
    '',
    `${input.spaceTitle} is a course from ${input.organizationName}.`,
    'If you were not expecting this, you can ignore this email.',
  ].join('\n');

  const html = `<div style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:32px">
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6">${escapeHtml(input.invitedBy)} invited you to take</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escapeHtml(input.spaceTitle)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#52525b">
      You have been invited as <strong>${escapeHtml(role)}</strong>, a course from ${escapeHtml(input.organizationName)}.
    </p>
    <a href="${escapeHtml(input.inviteUrl)}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600">Accept invitation</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a">
      Sign in with <strong>${escapeHtml(input.to)}</strong> — that is the address the invitation was sent to.
      Nothing in the course is visible to you until you accept.
    </p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#a1a1aa">
      If you were not expecting this, you can ignore this email.
    </p>
  </div>
</div>`;

  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: env.mailFromAddress,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: text, Charset: 'UTF-8' },
              Html: { Data: html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );

    return { sent: true, from: env.mailFromAddress };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    const message = err instanceof Error ? err.message : String(err);
    console.error('Course invitation email failed', { to: input.to, name, message });

    return { sent: false, from: env.mailFromAddress, error: `${name}: ${message}` };
  }
}

export interface SendRewardEmailInput {
  /** Address the grant belongs to. */
  to: string;
  /** What they were given. */
  rewardName: string;
  /** The reward's own words, when it has any. */
  rewardDescription?: string;
  /** Course the reward was earned in. */
  spaceTitle: string;
  /** Organization the course belongs to, named so the gift has a context. */
  organizationName: string;
  /** The code they redeem, on the kinds that carry one. */
  code?: string;
  /** What to do to claim it, when the reward is handed over by hand. */
  instructions?: string;
  /** Free text the instructor attached, e.g. where a gift card was sent. */
  note?: string;
  /** Who gave it: an instructor's name, or the course for a milestone. */
  grantedBy: string;
  /** Where they see it: the course's rewards in the marketplace. */
  rewardsUrl: string;
}

/**
 * Tells somebody they have been given something.
 *
 * The one email this service sends to a *learner* rather than to an invitee, and
 * it is the same principle: it carries a link to a page rather than a secret.
 * The reward is already theirs — the grant is written before this is sent — and
 * what the letter does is tell them it exists and where to look, which is the
 * only part they cannot work out for themselves.
 *
 * A reward without a code and without instructions is still worth the email: a
 * gift card that arrives silently is one nobody redeems.
 */
export async function sendRewardEmail(input: SendRewardEmailInput): Promise<MailDelivery> {
  if (!mailConfigured()) {
    return {
      sent: false,
      error: 'No sending address is configured for this deployment, so nothing was emailed.',
    };
  }

  const subject = `${input.grantedBy} gave you ${input.rewardName} in ${input.spaceTitle}`;

  const lines = [
    `${input.grantedBy} gave you ${input.rewardName} in ${input.spaceTitle}.`,
    ...(input.rewardDescription ? ['', input.rewardDescription] : []),
    ...(input.code ? ['', `Your code: ${input.code}`] : []),
    ...(input.note ? ['', input.note] : []),
    ...(input.instructions ? ['', input.instructions] : []),
    '',
    'See it in your rewards:',
    input.rewardsUrl,
    '',
    `${input.spaceTitle} is a course from ${input.organizationName}.`,
  ];

  /** One row of the letter: a label and what it says. */
  const row = (label: string, value: string) => `<tr>
      <td style="padding:0 0 12px;font-size:13px;line-height:1.5;color:#71717a;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
      <td style="padding:0 0 12px 16px;font-size:15px;line-height:1.5;color:#18181b"><strong>${escapeHtml(value)}</strong></td>
    </tr>`;

  const html = `<div style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:32px">
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6">${escapeHtml(input.grantedBy)} gave you</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escapeHtml(input.rewardName)}</h1>
    ${
      input.rewardDescription
        ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#52525b">${escapeHtml(input.rewardDescription)}</p>`
        : `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#52525b">In ${escapeHtml(input.spaceTitle)}, a course from ${escapeHtml(input.organizationName)}.</p>`
    }
    ${
      input.code || input.note
        ? `<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;border-top:1px solid #e4e4e7;padding-top:16px">
      ${input.code ? row('Code', input.code) : ''}
      ${input.note ? row('From', input.note) : ''}
    </table>`
        : ''
    }
    <a href="${escapeHtml(input.rewardsUrl)}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600">See your rewards</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a">
      Sign in with <strong>${escapeHtml(input.to)}</strong> and you will land on ${escapeHtml(input.spaceTitle)}'s rewards.
    </p>
    ${input.instructions ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#71717a">${escapeHtml(input.instructions)}</p>` : ''}
  </div>
</div>`;

  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: env.mailFromAddress,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: lines.join('\n'), Charset: 'UTF-8' },
              Html: { Data: html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );

    return { sent: true, from: env.mailFromAddress };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    const message = err instanceof Error ? err.message : String(err);
    console.error('Reward email failed', { to: input.to, name, message });

    return { sent: false, from: env.mailFromAddress, error: `${name}: ${message}` };
  }
}
