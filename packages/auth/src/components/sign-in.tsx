'use client';

import { createContext, useContext } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { PlayMark } from '@ui/components/play-mark';
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
 * Three things make it a screen rather than a form. The first is the frame: a
 * mark and a headline in a column on the page's own canvas, centred in the
 * window, with nothing drawn around them — a door rather than a panel. The
 * second is that the frame is the *Authenticator's own element* (`className`
 * below lands on `[data-amplify-authenticator]`), which is what lets the same
 * screen be two different things: a page of its own, and the wall the gate draws
 * over an app that has not been signed in to yet. Wrapping the component in a
 * div instead would put that div around the app's own screens the moment
 * somebody signed in. The third is that the two halves of the screen — signing
 * in and making an account — are reached from a line of text at the foot of the
 * form rather than from a segmented control above it, which is why this file
 * supplies both footers rather than leaving Amplify's own.
 *
 * The styling is two halves for the same reason. The markup this file owns — the
 * mark, the headline, the two footers — is written in the app's Tailwind
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
 * What an invitation puts on the screen.
 *
 * An invitation is the one way somebody arrives here knowing what they are
 * joining, and the screen should say so rather than asking a stranger to "make
 * an account" as though they had wandered in. It is also the reason the two
 * headings it replaces are the sign-in and the sign-up: those are the two halves
 * of the door, and the ones an invitation opens.
 *
 * The two fields are enough for that and no more. What is passed is what the
 * invitation itself says — the organization's name, and the course it is for —
 * so nothing here has to know what an invitation is or where one is kept.
 */
export interface SignInInvitation {
  /** Named in the heading: the organization whose course is being joined. */
  name: string;
  /** Said under the heading, when the offer has something to say for itself. */
  detail?: string;
}

/**
 * The invitation the screen is standing in front of, if it is one.
 *
 * A context rather than a prop, and not by preference: the parts below are handed
 * to the Authenticator once, at module level, because a fresh object on every
 * render is a fresh tree on every render — and a component that is the same
 * function every time cannot be handed a different invitation every time. The
 * context is what carries it in.
 */
const InvitationContext = createContext<SignInInvitation | undefined>(undefined);

/**
 * What the screen calls itself, given where it is and what it is standing in
 * front of.
 *
 * An invitation renames the two headings somebody arrives through — the sign-in
 * and the sign-up — and nothing else: the code in your inbox and the password you
 * are resetting are steps *inside* the door, and a step that said "Join Acme"
 * while it asked for a six-digit code would be the screen losing the thread.
 */
function headingFor(route: string, invitation?: SignInInvitation): Heading {
  if (invitation && (route === 'signIn' || route === 'signUp')) {
    return {
      title: `Join ${invitation.name}`,
      ...(invitation.detail ? { body: invitation.detail } : {}),
    };
  }

  return HEADINGS[route] ?? FALLBACK_HEADING;
}

/**
 * The mark, the headline and the sentence under it: everything above the form.
 */
function SignInHeading() {
  // Destructured rather than taken from the selector's return: Amplify types that
  // return as the whole authenticator context, whatever the selector asked for.
  const { route } = useAuthenticator((context) => [context.route]);
  const heading = headingFor(route, useContext(InvitationContext));

  return (
    <div className="mb-7 flex flex-col items-center text-center">
      {/* The same mark the apps carry in their own bars, drawn large enough to
          stand on its own: it is the one thing above the headline, and a page
          with a form on it needs something that says whose form it is. */}
      <PlayMark className="mb-5" />
      <h1 className="text-2xl font-semibold tracking-tight">{heading.title}</h1>
      {heading.body ? (
        // Wider than the form on purpose: the sentence above a form is a caption
        // on the screen, not a line of the form, and one that wrapped at the
        // form's own width would be a paragraph inside a column it is not inside.
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          {heading.body}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The way between the two halves of the screen, and the way out of a password.
 *
 * Amplify draws that choice as a pair of tabs above the form. A tab is the right
 * control for two views of one thing and the wrong one for two pages, and these
 * are two pages — one asks who you are and the other asks you to become
 * somebody — so the control is gone (in `sign-in.css`) and the choice is a line
 * of text under the button, which is where it is on every other door on the web.
 * Both halves have to offer the other or hiding the tabs would leave one of them
 * a dead end, which is why the footer is written here rather than borrowed.
 */
function SignInFooter() {
  const { toForgotPassword, toSignUp } = useAuthenticator((context) => [
    context.toForgotPassword,
    context.toSignUp,
  ]);

  return (
    <div className="mt-4 grid justify-items-center gap-1.5 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={toForgotPassword}
        className="transition-colors hover:text-foreground"
      >
        Forgot your password?
      </button>
      <p>
        New to Play?{' '}
        <button
          type="button"
          onClick={toSignUp}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create an account
        </button>
      </p>
    </div>
  );
}

/** The same line, said the other way round: the sign-up page's way back in. */
function SignUpFooter() {
  const { toSignIn } = useAuthenticator((context) => [context.toSignIn]);

  return (
    <p className="mt-4 text-center text-sm text-muted-foreground">
      Already have an account?{' '}
      <button
        type="button"
        onClick={toSignIn}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        Sign in
      </button>
    </p>
  );
}

/**
 * The parts of the Authenticator that are ours.
 *
 * `Header` sits outside the form — Amplify puts it in the same column as the
 * router but not inside it — which is exactly where a mark and a headline
 * belong. It is a module-level constant: the Authenticator spreads its custom
 * components on every render, and a fresh object each time would be a fresh tree
 * each time. The invitation reaches the header through a context rather than
 * through this object, for the same reason.
 */
const SIGN_IN_PARTS: React.ComponentProps<typeof Authenticator>['components'] = {
  Header: SignInHeading,
  SignIn: { Footer: SignInFooter },
  SignUp: { Footer: SignUpFooter },
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
  invitation,
  children,
}: {
  socialProviders?: AuthenticatorSocialProviders;
  /** Set when this screen is the doorway an invitation points at. */
  invitation?: SignInInvitation;
  children?: React.ReactNode;
}) {
  return (
    <InvitationContext.Provider value={invitation}>
      <Authenticator className="play-auth" socialProviders={socialProviders} components={SIGN_IN_PARTS}>
        {children}
      </Authenticator>
    </InvitationContext.Provider>
  );
}
