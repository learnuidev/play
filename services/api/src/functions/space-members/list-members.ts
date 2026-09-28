import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging, pathParam } from '../../lib/http';
import { getMembership } from '../../lib/organizations';
import { batchGetProfiles, nameFromEmail, toProfile } from '../../lib/profiles';
import {
  listSpaceMembers,
  spaceInvitationUrl,
  toApiSpaceMember,
} from '../../lib/space-members';

/**
 * A course's roster.
 *
 * Readable by everyone who can read the course — knowing who else is in the room
 * is part of being in it — but the addresses are for whoever may manage it, and
 * always for the person an outstanding invitation names, since it is their own.
 *
 * Every row carries the name and the photo its person chose, read in one batch
 * rather than one request per row. A roster that could only say `Member a1b2c3`
 * was a roster nobody could read, and it is also what the Instructors panel
 * picks from: choosing somebody to teach a course means choosing them by name.
 *
 * `canManage` is the caller's organization role, not their role in the course:
 * a viewer of the organization is a reader here even if they are the course's
 * instructor, because the roster is what the course's own settings govern.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await requireSpaceAccess(spaceId, user.userId, 'read');
  const membership = await getMembership(space.organizationId, user.userId);
  const canManage = membership?.status === 'ACTIVE' && membership.role !== 'VIEWER';

  const { members, lastEvaluatedKey } = await listSpaceMembers(spaceId, parsePaging(event));

  // Only the rows that are somebody's account: an outstanding invitation is
  // keyed by the address it was sent to, and there is no profile behind an
  // address.
  const profiles = await batchGetProfiles(
    members.filter((member) => member.status === 'ACTIVE').map((member) => member.userId),
  );

  const rows = await Promise.all(
    members.map(async (member) => {
      const profile = profiles.get(member.userId);
      if (!profile) {
        // No profile yet: their own address is the only name the API holds, and
        // this row is read by whoever may see addresses anyway — this is the same
        // name the studio's roster has always shown, just spelled out.
        const fromEmail = nameFromEmail(member.email);
        return toApiSpaceMember(member, user, canManage, {
          ...(fromEmail ? { name: fromEmail } : {}),
        });
      }

      const withPhoto = await toProfile(profile);
      return toApiSpaceMember(member, user, canManage, {
        name: withPhoto.name,
        ...(withPhoto.photoUrl ? { photoUrl: withPhoto.photoUrl } : {}),
      });
    }),
  );

  return ok({
    members: rows,
    canManage,
    ...(canManage ? { inviteUrl: spaceInvitationUrl(space.organizationId, spaceId) } : {}),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
