/**
 * Where a piece of an ordered list lands when somebody moves it.
 *
 * Both drag-and-drop surfaces in this service ask the same question — "this
 * question, third from the top" / "this lesson, into that section, second" — and
 * the arithmetic is identical and easy to get wrong in a way nothing notices:
 * an off-by-one puts the row one place out, and the author drags it again.
 *
 * So it is one pure function, and the two callers differ only in what they then
 * write. The index is a *place*, clamped rather than refused: dropping a row on
 * the gap below the last one means the end of the list, which is what a person
 * means by it.
 */
export function moveIntoPlace<T>(
  items: T[],
  isMoved: (item: T) => boolean,
  moved: T,
  index: number,
): T[] {
  const without = items.filter((item) => !isMoved(item));
  const at = Math.max(0, Math.min(Math.trunc(index), without.length));
  without.splice(at, 0, moved);
  return without;
}
