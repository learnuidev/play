import type { NotesDocument } from '@/types';

/**
 * The document an empty editor holds, so "no notes" has one representation
 * rather than two — an absent one and an empty one.
 */
export const EMPTY_NOTES: NotesDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Whether a notes document has anything in it worth rendering.
 *
 * ProseMirror represents "nothing written" as a document containing an empty
 * paragraph, so the question is really whether any text made it into the tree.
 */
export function isEmptyNotes(notes: NotesDocument | undefined): boolean {
  if (!notes) return true;
  const content = notes.content as Array<Record<string, unknown>> | undefined;
  if (!content || content.length === 0) return true;
  return !JSON.stringify(content).match(/"text":"[^"]/);
}
