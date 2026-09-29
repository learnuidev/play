"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CloudIcon,
  GlobeIcon,
  MoonIcon,
  PlusIcon,
  RocketIcon,
  ServerIcon,
  SunIcon,
  TerminalIcon,
} from "lucide-react";

import { Chip, Dot } from "@/components/ui/chip";
import { Button, IconButton } from "@/components/ui/button";
import { useNameStage, useShell, useTheme } from "@/components/console/state";
import { cn } from "@/lib/cn";

/**
 * The frame: a rail on the left, and the page beside it.
 *
 * Two things about it are decisions rather than layout.
 *
 * **The rail is the environment picker.** Not a dropdown in the header: the
 * environment is the subject of every screen here, and a control that is on
 * screen the whole time says so. Selecting one changes what the deploy page is
 * about and what the frontend cards would be started against, from one place.
 *
 * **The chrome never moves.** The rail is `h-screen` and the bar is sticky and
 * translucent, so scrolling a thirteen-step checklist and a thousand-line
 * transcript never takes the controls off screen. That is the whole reason the
 * console exists rather than a shell script and a `tail -f`.
 */

/**
 * The rail, in three parts.
 *
 * The console has one subject — a backend, in an environment — and two things
 * that hang off it: the frontends that consume it, and the services it is
 * deployed through. So the rail is those three, in that order, rather than a
 * list of pages: *what you are deploying*, *what reads it*, and *where it
 * lives*.
 *
 * The environment is deliberately **not** in the rail. It is a dropdown on the
 * page it applies to, beside the other dropdown that answers the same shape of
 * question — which backend, which environment — and it writes the same state
 * the whole console reads, so moving between pages keeps the environment you
 * were looking at.
 */
const NAV = [
  {
    href: "/backends",
    label: "Backends",
    icon: CloudIcon,
    hint: "the API, per environment",
  },
  {
    href: "/frontends",
    label: "Frontends",
    icon: ServerIcon,
    hint: "the three apps, and what they read",
  },
] as const;

const INTEGRATIONS = [
  { href: "/integrations/aws", label: "AWS", icon: RocketIcon },
  { href: "/integrations/vercel", label: "Vercel", icon: GlobeIcon },
] as const;

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { state, stage, error, loading, refreshing, refresh } = useShell();
  const pathname = usePathname();

  return (
    <div className="relative flex min-h-screen">
      <div aria-hidden className="cp-canvas pointer-events-none fixed inset-0 -z-10" />

      <Rail />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border/40 bg-background/70 sticky top-0 z-30 flex h-12 items-center gap-3 border-b px-4 backdrop-blur-xl sm:px-6">
          <MobilePicker />

          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <Chip tone="accent" monospace>
              {stage}
            </Chip>
            {state?.identity ? (
              <span className="text-muted-foreground truncate font-mono text-xs">
                {state.identity.account} · {state.region}
              </span>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1">
            {error ? (
              <Chip tone="bad" className="mr-1 hidden md:inline-flex">
                {error}
              </Chip>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              busy={refreshing || loading}
              className="font-mono"
            >
              refresh
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-24 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The rail
 * ------------------------------------------------------------------ */

function Rail() {
  const { state, stage, loading } = useShell();

  return (
    <aside className="border-border/60 bg-card/40 sticky top-0 hidden h-screen w-72 shrink-0 flex-col gap-6 border-r px-4 py-6 backdrop-blur-xl lg:flex">
      <Brand />

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <NavItem key={item.href} {...item} />
        ))}

        <p className="text-muted-foreground mt-5 px-3 text-xs font-medium tracking-wide uppercase">
          Integrations
        </p>
        {INTEGRATIONS.map((item) => (
          <NavItem key={item.href} {...item} compact />
        ))}
      </nav>

      {/*
        The environments are *not* listed here. Which environment you are
        looking at is a dropdown on the page it applies to, sitting beside the
        other dropdown that answers the same shape of question — and a list here
        would be a second place to select the same thing, which is a second
        answer to one question. What is left is the one action that has nowhere
        else to live: naming a stage that does not exist yet.
      */}
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2">
        <NewEnvironment />
      </div>

      <Identity />
    </aside>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-2">
      <span className="bg-foreground text-background flex size-9 shrink-0 items-center justify-center rounded-2xl">
        <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 translate-x-px fill-current">
          <path d="M3 1.5 13.5 8 3 14.5z" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">Play</span>
        <span className="text-muted-foreground text-xs">Console</span>
      </span>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  hint,
  compact = false,
}: {
  href: string;
  label: string;
  icon: typeof RocketIcon;
  /**
   * The line under the name. The integrations have none: the two of them are
   * named by what they are, and a subtitle nobody reads is a row that says the
   * same thing twice.
   */
  hint?: string;
  /** Integrations sit inside a group, so they are one line rather than two. */
  compact?: boolean;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-2xl px-3 transition-colors",
        compact ? "py-2" : "py-2.5",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        {!compact && hint ? (
          <span className="text-muted-foreground truncate text-xs">{hint}</span>
        ) : null}
      </span>
      {compact && hint ? (
        <span className="text-muted-foreground shrink-0 truncate text-xs">{hint}</span>
      ) : null}
    </Link>
  );
}

/**
 * Naming a stage that does not exist yet.
 *
 * It is here rather than behind a dialog because the answer to "which
 * environment" is sometimes "one that is not there yet", and a picker that only
 * offers what exists makes that a repository edit rather than a click. The
 * stage is only *named* — the deploy page's third step is what gives it a
 * config file.
 */
function NewEnvironment() {
  const name = useNameStage();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-accent/60 hover:text-foreground flex items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs transition-colors"
      >
        <PlusIcon className="size-3.5" />
        New environment
      </button>
    );
  }

  const commit = () => {
    const trimmed = value.trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9-]{0,30}$/.test(trimmed)) {
      name(trimmed);
      setOpen(false);
      setValue("");
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
      className="flex items-center gap-1 px-1"
    >
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setValue("");
          }
        }}
        placeholder="staging"
        className="border-border/70 bg-background/60 focus-visible:ring-ring h-8 min-w-0 flex-1 rounded-full border px-3 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
      />
      <IconButton
        type="submit"
        title="Use this stage"
        aria-label="Use this stage"
        disabled={!/^[a-z0-9][a-z0-9-]{0,30}$/.test(value.trim().toLowerCase())}
      >
        <PlusIcon className="size-3.5" />
      </IconButton>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Who we are, and how to see
 * ------------------------------------------------------------------ */

function Identity() {
  const { state } = useShell();
  const identity = state?.identity;

  return (
    <div className="border-border/60 bg-background/40 flex flex-col gap-2 rounded-3xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <CloudIcon className="size-3.5" />
        AWS
        {identity ? <Dot tone="ok" className="ml-auto" /> : <Dot tone="bad" className="ml-auto" />}
      </div>
      <p className="truncate font-mono text-xs">{state?.profile ?? "…"}</p>
      {identity ? (
        <p className="text-muted-foreground truncate text-xs" title={identity.arn}>
          {identity.account} · {state?.region}
        </p>
      ) : (
        <p className="text-destructive text-xs leading-snug">
          {state?.identityError ?? "Reading credentials…"}
        </p>
      )}
      <p className="text-muted-foreground/80 truncate text-xs" title={state?.repoRoot}>
        {state?.profileSource}
      </p>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <IconButton
      onClick={toggle}
      title={theme === "dark" ? "Light" : "Dark"}
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </IconButton>
  );
}

/* ------------------------------------------------------------------ *
 * Small screens
 * ------------------------------------------------------------------ */

/**
 * Below `lg` the rail is gone and the environment moves into the bar.
 *
 * A native `select` rather than a rebuilt one: it is one control, it is used on
 * the screen where a popover is most annoying, and it is keyboard-correct for
 * free.
 */
function MobilePicker() {
  const { stages, stage, setStage } = useShell();
  return (
    <div className="flex items-center gap-2 lg:hidden">
      <TerminalIcon className="text-muted-foreground size-4" />
      <select
        value={stage}
        onChange={(event) => setStage(event.target.value)}
        aria-label="Environment"
        className="border-border/70 bg-background/60 h-8 rounded-full border px-3 font-mono text-xs focus-visible:outline-none"
      >
        {stages.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </select>
    </div>
  );
}
