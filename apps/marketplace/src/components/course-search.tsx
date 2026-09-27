'use client';

import { SearchIcon, XIcon } from 'lucide-react';

/**
 * The catalog's search box, in the shape a search box has on a phone.
 *
 * A full pill rather than a rectangle with a border: the field is one gesture —
 * put words in it — and a hairline box around it makes it look like a form. The
 * fill is the muted surface, which is what the rest of this design uses to mean
 * "a thing you put something into".
 *
 * A real `<form>`, so Enter is the browser's own submit rather than a key
 * handler of ours: it is also what gives a phone's keyboard a Search key. The
 * magnifier is that submit as a button, for anybody who would rather tap it, and
 * the clear button empties the box without searching.
 *
 * The browser's own clear button is suppressed because the one here is
 * reachable, labelled and says what it does.
 */
export function CourseSearch({
  value,
  onChange,
  onSubmit,
}: {
  /** What is in the box, which is not necessarily what is being shown. */
  value: string;
  onChange: (next: string) => void;
  /** Searches for what is in the box. */
  onSubmit: () => void;
}) {
  return (
    <form
      role="search"
      onSubmit={(event) => {
        // A submit would otherwise reload the page.
        event.preventDefault();
        onSubmit();
      }}
      className="relative w-full"
    >
      <button
        type="submit"
        aria-label="Search"
        className="absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        <SearchIcon className="size-4" />
      </button>

      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search"
        aria-label="Search courses"
        autoComplete="off"
        enterKeyHint="search"
        className="h-12 w-full rounded-full bg-muted pr-12 pl-11 text-base text-foreground transition-shadow outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:appearance-none"
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </form>
  );
}
