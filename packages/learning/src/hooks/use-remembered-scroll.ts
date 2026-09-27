'use client';

import { useCallback, useRef } from 'react';

/**
 * Where a scrolling panel was left, kept by name for the life of the page.
 *
 * The panel is remounted by every change of lesson, so anything the reader had
 * scrolled — the course list they are picking lessons out of, most of all —
 * snapped back to the top the moment they picked one. The list is the same list
 * before and after, so its position is worth keeping.
 *
 * Positions rather than offsets from the lesson being read: the sheet that
 * follows a playhead is left alone, and the course list is short enough that the
 * row you clicked is still near where you left it even if a lesson above it
 * moved in between.
 *
 * A callback ref rather than a `useRef` and an effect, because the element is
 * not always there when the page mounts: the tabs that are not open are not
 * mounted at all, so the element arrives later, when the reader switches to it —
 * and the position has to be written back in the same commit the content is
 * committed in, before the browser paints, or the reader watches the sheet jump.
 */
const positions = new Map<string, number>();

export function useRememberedScroll<T extends HTMLElement>(key: string) {
  const saveRef = useRef<() => void>(() => {});

  return useCallback(
    (node: T | null) => {
      // Whatever was attached is going away: its last position is the last word
      // on where the reader was.
      saveRef.current();
      saveRef.current = () => {};

      if (!node) return;

      const save = () => positions.set(key, node.scrollTop);
      node.addEventListener('scroll', save, { passive: true });

      const wanted = positions.get(key);
      if (wanted) node.scrollTop = wanted;

      saveRef.current = () => {
        node.removeEventListener('scroll', save);
        save();
      };
    },
    [key],
  );
}
