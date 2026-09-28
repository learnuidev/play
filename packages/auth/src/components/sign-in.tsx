'use client';

import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import '@auth/sign-in.css';

/**
 * The sign-in screen.
 *
 * Amplify's `Authenticator` is the machinery — password, confirmation codes,
 * forgotten passwords, Google — and this is the screen around it. The split is
 * deliberate: the flows change when the user pool changes and the layout does
 * not, so the flows stay Amplify's and everything a person actually looks at is
 * written here.
 *
 * Two things make it a screen rather than a form. The first is the frame: a
 * frosted card on a canvas with two slow washes of colour behind it, a headline
 * above it, and the whole thing centered in the window — Apple's sign-in page
 * rather than a panel bolted to the top of a page. The second is that the frame
 * is the *Authenticator's own element* (`className` below lands on
 * `[data-amplify-authenticator]`), which is what lets the same screen be two
 * different things: a page of its own, and the wall the gate draws over an app
 * that has not been signed in to yet. Wrapping the component in a div instead
 * would put that div around the app's own screens the moment somebody signed in.
 *
 * The styling is two halves for the same reason. The markup this file owns — the
 * headline — is written in the app's Tailwind vocabulary; the markup
 * Amplify owns is restyled in `sign-in.css`, in the app's *tokens*, so the screen
 * is the studio's when it renders there and the marketplace's when it renders
 * there. Nothing here names an app, a route or a URL: `@play/auth` is shared, and
 * a shared screen that assumed one app's routes would be wrong in the other.
 */

/** The identity providers the Authenticator knows how to draw a button for. */
type AuthenticatorSocialProviders = React.ComponentProps<typeof Authenticator>['socialProviders'];

/** What the screen is called, and what it promises, on each route it can be on. */
interface Heading {
  title: string;
  /** Optional: a title on its own is enough on some routes. */
  body?: string;
}

/**
 * The headline, per route.
 *
 * The Authenticator is a router, not a form: the same screen is the sign-in, the
 * sign-up, the code you were emailed and the password you are resetting, and a
 * headline that said "Sign in" over a form asking for a confirmation code would
 * be wrong at the exact moment somebody is least sure what is happening.
 */
const HEADINGS: Record<string, Heading> = {
  signIn: {
    title: 'Sign in to Play',
  },
  signUp: {
    title: 'Make an account',
  },
  forgotPassword: {
    title: 'Reset your password',
    body: 'Tell us the address you signed up with and we will send you a code.',
  },
  confirmResetPassword: {
    title: 'Set a new password',
    body: 'The code is in your inbox. Choose something you have not used here before.',
  },
  confirmSignUp: {
    title: 'Check your inbox',
    body: 'One code and you are in. It is worth keeping — you will need it if you ever sign in from somewhere new.',
  },
};

/** Everything else the Authenticator can ask for — a second factor, a new password. */
const FALLBACK_HEADING: Heading = {
  title: 'Almost there',
  body: 'One more step and you are in.',
};

/**
 * The headline: everything above the card.
 */
function SignInHeading() {
  // Destructured rather than taken from the selector's return: Amplify types that
  // return as the whole authenticator context, whatever the selector asked for.
  const { route } = useAuthenticator((context) => [context.route]);
  const heading = HEADINGS[route] ?? FALLBACK_HEADING;

  return (
    <div className="mb-7 flex flex-col items-center text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{heading.title}</h1>
      {heading.body ? (
        // Wider than the card on purpose: the sentence above a form is a caption
        // on the screen, not a line of the form, and one that wrapped at the
        // card's own 420px would be a paragraph inside a column it is not inside.
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          {heading.body}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The parts of the Authenticator that are ours.
 *
 * `Header` sits outside the card — Amplify puts it in the same column as the
 * router but not inside it — which is exactly where a headline belongs. It is a
 * module-level constant: the Authenticator spreads its custom components on
 * every render, and a fresh object each time would be a fresh tree each time.
 */
const SIGN_IN_PARTS: React.ComponentProps<typeof Authenticator>['components'] = {
  Header: SignInHeading,
};

/**
 * The sign-in screen, with or without the app behind it.
 *
 * With `children` it is the gate: they render once somebody is signed in, and
 * they render *instead of* this screen rather than inside it. Without them it is
 * the sign-in page itself.
 */
export function SignInScreen({
  socialProviders,
  children,
}: {
  socialProviders?: AuthenticatorSocialProviders;
  children?: React.ReactNode;
}) {
  return (
    <Authenticator className="play-auth" socialProviders={socialProviders} components={SIGN_IN_PARTS}>
      {children}
    </Authenticator>
  );
}
