/**
 * The little formatting the console does, in one place.
 *
 * Every function here takes something the server sent and returns a string for
 * a person. Nothing reads the clock twice, so nothing on a row can disagree
 * with the row above it about when it happened.
 */

/** `620` → `620ms`, `12_400` → `12.4s`, `134_000` → `2m 14s`, `3_700_000` → `1h 1m`. */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** `14:02:11`, in the reader's own locale — a console is read at a glance. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** `just now`, `4m ago`, `2h ago`, `on 12 Mar`. */
export function relative(at: number, now: number): string {
  const delta = now - at;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The host of an API URL, which is what fits on a chip. */
export function apiHost(url: string | null | undefined): string {
  if (!url) return "no API";
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/**
 * `PlayApiStack-dev` → `Api`.
 *
 * The root stacks differ by one word and every chip beside them is short, so the
 * word is what the chip says and the full name is in its title.
 */
export function stackWord(name: string): string {
  const match = /^Play(\w+?)Stack-/.exec(name);
  return match ? match[1] : name;
}

/** `PlayApiStack-dev` → `API`, which is how the product spells it. */
export function stackInitials(word: string): string {
  if (word.toLowerCase() === "api") return "API";
  return word;
}
