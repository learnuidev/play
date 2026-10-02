import { AuthGate } from '@play/auth';
import { AccountTabs } from '@/components/account/account-tabs';

/**
 * The account: the three screens that are about the person rather than about a
 * course.
 *
 * Behind a gate, because there is nothing here to read first — every one of the
 * three asks the API who the caller is, and a signed-out visitor would get a 401
 * behind an empty page. The gate sends them to sign in and back to the same URL,
 * which is the deal every signed-in page in this app makes.
 *
 * The header and the tabs live here rather than on each page, so the three
 * cannot drift apart about what they are part of, and the pages underneath bring
 * a section rather than a screenful.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
        <header className="mb-8 grid gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your account</h1>
            <p className="mt-2 text-lg text-muted-foreground">
              Who you are, what you pay with, and what you have bought.
            </p>
          </div>
          <AccountTabs />
        </header>

        {children}
      </div>
    </AuthGate>
  );
}
