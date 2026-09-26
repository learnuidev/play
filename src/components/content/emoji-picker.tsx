'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchIcon, SmileIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  EMOJI_GROUPS,
  emojiName,
  rememberEmoji,
  recentEmoji,
  searchEmoji,
  type Emoji,
} from '@/lib/emoji';

/**
 * The emoji palette, and the button that opens it.
 *
 * A comment box is a sentence being written, so the palette is a keyboard: the
 * panel opens against the box, picking puts the emoji at the caret, and nothing
 * about it is a separate screen or a mode — the words keep being typed around
 * it.
 *
 * A popover of its own rather than a menu, because it holds a search field and
 * a grid of buttons, which is a small dialog and not a list of commands. Being
 * its own component is what lets the composer stay about the sentence.
 */

/** The panel's width: eight emoji across, the way the grid is drawn. */
const PANEL_WIDTH = 296;
/** Taller than this and it stops being a palette and starts being a page. */
const PANEL_MAX_HEIGHT = 320;
/** Clearance from the button, and from the window's edges. */
const GAP = 8;

interface Placement {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Where the panel goes.
 *
 * Measured against the *window* rather than placed in the flow of the comment
 * list, because the list scrolls inside the lesson panel: a panel positioned
 * absolutely in there is clipped by the scroller the moment it needs to open
 * past the top or the bottom of it, which is exactly when there is most to show.
 *
 * It opens on whichever side of the button has room, and is capped to what that
 * side actually holds — so a box near the bottom of a window opens upward
 * instead of running off the screen, and one in the middle gets the taller half.
 */
function placePanel(trigger: HTMLElement): Placement {
  const rect = trigger.getBoundingClientRect();
  const above = rect.top - GAP;
  const below = window.innerHeight - rect.bottom - GAP;
  const opensUp = above >= below;

  const left = Math.min(
    Math.max(GAP, rect.left),
    Math.max(GAP, window.innerWidth - PANEL_WIDTH - GAP),
  );

  const maxHeight = Math.max(180, Math.min(PANEL_MAX_HEIGHT, opensUp ? above : below) - GAP);

  return opensUp
    ? { left, bottom: window.innerHeight - rect.top + GAP, maxHeight }
    : { left, top: rect.bottom + GAP, maxHeight };
}

/** One emoji in the grid. */
function EmojiButton({ emoji, onPick }: { emoji: Emoji; onPick: (char: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(emoji.char)}
      title={emoji.name}
      aria-label={emoji.name}
      className="flex size-8 items-center justify-center rounded-md text-lg leading-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span aria-hidden>{emoji.char}</span>
    </button>
  );
}

export function EmojiPicker({ onPick, className }: { onPick: (char: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  /**
   * The recents are read when the panel opens rather than once at mount: this
   * component lives inside a box that is destroyed whenever the reader leaves
   * the tab, so a list read at mount would be a list from the last time the
   * component happened to exist.
   */
  useEffect(() => {
    if (!open) {
      setQuery('');
      setPlacement(null);
      return;
    }

    setRecent(recentEmoji());

    // Focused on open, so the palette can be searched without reaching for it.
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  /**
   * Kept against the button while the page moves.
   *
   * The panel is placed from the button's position on screen, so a scroll or a
   * resize has to place it again — on the capture phase, because the thing that
   * scrolls here is the lesson panel and not the window.
   */
  useLayoutEffect(() => {
    if (!open) return;

    function reposition() {
      if (trigger.current) setPlacement(placePanel(trigger.current));
    }

    reposition();
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  /**
   * Clicking away, or pressing Escape, closes it.
   *
   * On the document rather than behind a backdrop: the panel floats over the
   * comment list, and a backdrop would swallow the first click on the row
   * behind it — which is usually the click the reader was actually making.
   */
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const results = useMemo(() => searchEmoji(query), [query]);
  /** What the panel is showing: the matches, or the whole palette by group. */
  const searching = query.trim().length > 0;

  function pick(char: string) {
    onPick(char);
    setRecent(rememberEmoji(char));
    setOpen(false);
  }

  return (
    <div className={cn('relative', className)}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-label="Add an emoji"
        title="Add an emoji"
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground',
          open ? 'bg-accent text-foreground' : 'text-muted-foreground/70',
        )}
      >
        <SmileIcon className="size-4" />
      </button>

      {open &&
        placement &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Emoji"
            style={{
              left: placement.left,
              top: placement.top,
              bottom: placement.bottom,
              width: PANEL_WIDTH,
              maxHeight: placement.maxHeight,
            }}
            className="fixed z-50 flex flex-col rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
          >
            {/* A search field rather than tabs across the top: the groups are
                short enough to scroll past, and the one emoji somebody wants is
                almost always faster to type than to find. */}
            <div className="relative shrink-0">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search emoji"
                aria-label="Search emoji"
                className="h-8 pl-7 text-[13px]"
              />
            </div>

            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5">
              {searching ? (
                results.length > 0 ? (
                  <div className="grid grid-cols-8 justify-items-center gap-0.5">
                    {results.map((emoji) => (
                      <EmojiButton key={`${emoji.char}-${emoji.name}`} emoji={emoji} onPick={pick} />
                    ))}
                  </div>
                ) : (
                  <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">
                    Nothing matches “{query.trim()}”.
                  </p>
                )
              ) : (
                <>
                  {/* Recents first, because the emoji somebody uses is a habit:
                      the same handful does most of the work in a discussion. */}
                  {recent.length > 0 && (
                    <div className="mb-1">
                      <GroupLabel>Recent</GroupLabel>
                      <div className="grid grid-cols-8 justify-items-center gap-0.5">
                        {recent.map((char) => (
                          <EmojiButton
                            key={char}
                            emoji={{ char, name: emojiName(char) ?? char }}
                            onPick={pick}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {EMOJI_GROUPS.map((group) => (
                    <div key={group.name} className="mb-1 last:mb-0">
                      <GroupLabel>{group.name}</GroupLabel>
                      <div className="grid grid-cols-8 justify-items-center gap-0.5">
                        {group.emojis.map((emoji) => (
                          <EmojiButton key={`${emoji.char}-${emoji.name}`} emoji={emoji} onPick={pick} />
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A group's name, quiet and above its row. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </p>
  );
}
