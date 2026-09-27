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
 * frosted card on a canvas with two slow washes of colour behind it, a mark
 * above it, and the whole thing centered in the window — Apple's sign-in page
 * rather than a panel bolted to the top of a page. The second is that the frame
 * is the *Authenticator's own element* (`className` below lands on
 * `[data-amplify-authenticator]`), which is what lets the same screen be two
 * different things: a page of its own, and the wall the gate draws over an app
 * that has not been signed in to yet. Wrapping the component in a div instead
 * would put that div around the app's own screens the moment somebody signed in.
 *
 * The styling is two halves for the same reason. The markup this file owns — the
 * mark, the headline, the note under the card — is written in the app's Tailwind
 * vocabulary; the markup Amplify owns is restyled in `sign-in.css`, in the app's
 * *tokens*, so the screen is the studio's when it renders there and the
 * marketplace's when it renders there. Nothing here names an app, a route or a
 * URL: `@play/auth` is shared, and a shared screen that assumed one app's routes
 * would be wrong in the other.
 */

/** The identity providers the Authenticator knows how to draw a button for. */
type AuthenticatorSocialProviders = React.ComponentProps<typeof Authenticator>['socialProviders'];

/** What the screen is called, and what it promises, on each route it can be on. */
interface Heading {
  title: string;
  body: string;
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
    body: 'Your courses, your notes and your place in every lesson — on whatever you happen to be holding.',
  },
  signUp: {
    title: 'Make an account',
    body: 'One account for both sides of Play: the studio where courses are built, and the marketplace where people take them.',
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
 * The mark, drawn rather than imported.
 *
 * `@play/auth` has no icon dependency and does not want one for a single glyph,
 * and the app's headers draw this same shape with a lucide icon they already
 * have. Here it is a rounded square in the foreground colour with the play
 * triangle knocked out of it.
 */
function PlayMark() {
  return (
    <span
      aria-hidden
      className="flex size-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg shadow-black/20 ring-1 ring-inset ring-background/10"
    >
      <svg viewBox="0 0 24 24" className="size-5 fill-current">
        <path d="M8.4 4.9a1 1 0 0 1 1.53-.85l9.2 6.25a1 1 0 0 1 0 1.66l-9.2 6.25a1 1 0 0 1-1.53-.85V4.9Z" />
      </svg>
    </span>
  );
}

/** The mark, the headline and the sentence under it: everything above the card. */
function SignInHeading() {
  // Destructured rather than taken from the selector's return: Amplify types that
  // return as the whole authenticator context, whatever the selector asked for.
  const { route } = useAuthenticator((context) => [context.route]);
  const heading = HEADINGS[route] ?? FALLBACK_HEADING;

  return (
    <div className="mb-7 flex flex-col items-center text-center">
      <PlayMark />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{heading.title}</h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground sm:max-w-md lg:max-w-xl">
        {heading.body}
      </p>
    </div>
  );
}

/**
 * The line under the card.
 *
 * A sign-in screen asks for a password, and the smallest honest answer to "what
 * happens to it" belongs on the screen that asks — it is not a privacy policy,
 * it is the one fact that makes typing into the box reasonable.
 */
function SignInNote() {
  return (
    <p className="mt-6 max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
      Your password is checked by Amazon Cognito and never reaches the Play API.
    </p>
  );
}

/**
 * The parts of the Authenticator that are ours.
 *
 * `Header` and `Footer` sit outside the card — Amplify puts them in the same
 * column as the router but not inside it — which is exactly where a headline and
 * a piece of small print belong. Both are module-level constants: the
 * Authenticator spreads its custom components on every render, and a fresh
 * object each time would be a fresh tree each time.
 */
const SIGN_IN_PARTS: React.ComponentProps<typeof Authenticator>['components'] = {
  Header: SignInHeading,
  Footer: SignInNote,
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
