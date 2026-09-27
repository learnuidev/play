import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type {
  PreSignUpTriggerHandler,
  PreSignUpTriggerEvent,
} from "aws-lambda";

/**
 * Pre sign-up trigger: links a first-time federated (Google) sign-in to an
 * existing password account with the same email address.
 *
 * Without this, Cognito treats "signed up with a password" and "signed in with
 * Google" as two different people: on a federated user's first sign-in it looks
 * for a profile that was *already* linked to that identity, and if it finds none
 * it creates a brand new profile. Two profiles means two `sub` values, and since
 * every video is scoped to `ownerId` (the `sub`), the same human sees two
 * separate libraries.
 *
 * The link has to happen before the federated profile exists, which is exactly
 * what this trigger runs: `PreSignUp_ExternalProvider` fires once per federated
 * user, immediately before Cognito creates their profile. Linking here means
 * Cognito finds the linked profile and signs the user into it. (For a Google
 * account that has *already* signed in once, the federated profile must be
 * deleted first — see the "Linking" section of the README.)
 *
 * Two conditions keep this safe:
 *
 *   1. The federated email must be verified (`email_verified` is mapped from
 *      Google's own claim), and the local profile's email must be verified too.
 *      Linking on an unverified address would let anyone who can receive mail at
 *      a victim's address inherit their account.
 *   2. Only `Google` is linked, because social IdPs link by `Cognito_Subject`;
 *      OIDC and SAML providers use a mapped claim name instead.
 */

const cognito = new CognitoIdentityProviderClient({});

const NAME_SEPARATOR = "_";

/** The only social provider this stack configures. */
const SOCIAL_PROVIDER = "Google";

/** ListUsers caps Limit at 60; a filter matches users, not the whole pool. */
const USER_LOOKUP_LIMIT = 60;

export const handler: PreSignUpTriggerHandler = async (
  event: PreSignUpTriggerEvent,
) => {
  try {
    await linkToExistingAccount(event);
  } catch (error) {
    // Never fail the sign-in: if linking does not work the user simply gets a
    // separate federated profile, which is what happens without this trigger.
    console.error("link-federated-user: could not link account", error);
  }
  return event;
};

async function linkToExistingAccount(
  event: PreSignUpTriggerEvent,
): Promise<void> {
  if (event.triggerSource !== "PreSignUp_ExternalProvider") return;

  // Cognito derives a federated username from the IdP name and the provider's
  // subject claim — for Google that is `Google_<sub>`, which is also the value
  // AdminLinkProviderForUser needs as the source identifier.
  const separator = event.userName.indexOf(NAME_SEPARATOR);
  if (separator < 1) return;

  const providerName = event.userName.slice(0, separator);
  const providerUserId = event.userName.slice(separator + 1);
  if (providerName !== SOCIAL_PROVIDER || !providerUserId) return;

  const { email, email_verified: emailVerified } = event.request.userAttributes;

  if (!email || emailVerified !== "true") {
    console.log(
      `link-federated-user: not linking ${event.userName} — email ` +
        `${email ?? "(missing)"} is not verified`,
    );
    return;
  }

  const destinationUsername = await findLocalUsernameByEmail(
    event.userPoolId,
    email,
  );
  if (!destinationUsername) {
    console.log(
      `link-federated-user: no local account for ${email}; creating a new profile`,
    );
    return;
  }

  await cognito.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId: event.userPoolId,
      // The existing password account, identified by its username.
      DestinationUser: {
        ProviderName: "Cognito",
        ProviderAttributeValue: destinationUsername,
      },
      // The incoming Google identity. Social IdPs must use Cognito_Subject,
      // which makes Cognito parse `sub` from the provider's token.
      SourceUser: {
        ProviderName: providerName,
        ProviderAttributeName: "Cognito_Subject",
        ProviderAttributeValue: providerUserId,
      },
    }),
  );

  console.log(
    `link-federated-user: linked ${providerName} identity to ${destinationUsername}`,
  );
}

/**
 * Finds the oldest local (password) profile for `email`.
 *
 * Federated profiles are skipped: they carry an `identities` attribute, and
 * their usernames are IdP-derived, so linking to one would chain identities in
 * the wrong direction.
 */
async function findLocalUsernameByEmail(
  userPoolId: string,
  email: string,
): Promise<string | undefined> {
  const escaped = email.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const { Users = [] } = await cognito.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${escaped}"`,
      Limit: USER_LOOKUP_LIMIT,
    }),
  );

  const candidates = Users.filter((user) => {
    const attributes = Object.fromEntries(
      (user.Attributes ?? []).map(({ Name, Value }) => [Name, Value]),
    );

    if (!user.Username) return false;
    if (attributes.identities) return false;
    if (user.Username.startsWith(`${SOCIAL_PROVIDER}${NAME_SEPARATOR}`))
      return false;

    return attributes.email_verified === "true";
  }).sort(
    (a, b) =>
      (a.UserCreateDate?.getTime() ?? 0) - (b.UserCreateDate?.getTime() ?? 0),
  );

  // Oldest first: if a pool somehow holds several local profiles for one
  // address, always link to the same one.
  return candidates[0]?.Username;
}
