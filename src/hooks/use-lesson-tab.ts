'use client';

import { useCallback, useState } from 'react';

/**
 * Which tab the lesson panel was last left on, remembered across lessons.
 *
 * The panel used to open on the transcript every time, which made the Course tab
 * useless as a way around a course: choosing the next lesson in the list threw
 * the reader back out of the list they were reading. What you are looking at is
 * part of where you are, so it outlives the lesson it was chosen on.
 *
 * A module rather than the URL, because it is a preference about the panel and
 * not a fact about the lesson: every link into a lesson would otherwise have to
 * carry it, including the ones this page builds for "next lesson" and the
 * playing-next card. And a module rather than `sessionStorage`, because it is a
 * view and not a setting: opening the app afresh should open on the transcript,
 * which is the tab a lesson is watched with.
 */
const DEFAULT_TAB = 'transcript';

let lastTab = DEFAULT_TAB;

/**
 * The remembered tab, and the way to change it.
 *
 * `useState(lastTab)` rather than a subscription: the page is remounted by a
 * change of lesson and nothing else is listening, so reading the module once at
 * mount is the whole of what is needed.
 */
export function useLessonTab() {
  const [tab, setTab] = useState(lastTab);

  const chooseTab = useCallback((value: string) => {
    lastTab = value;
    setTab(value);
  }, []);

  return [tab, chooseTab] as const;
}
