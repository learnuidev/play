import type { NotesDocument } from '@play/types';

/**
 * A lesson's notes, as text.
 *
 * This is the one place the demo has to do something Play's own apps do not, and
 * it is worth explaining because it is a decision the API made on purpose.
 * `/v1/lessons/{contentId}` hands the notes over as the document the author
 * wrote — a ProseMirror tree, not HTML — because an API that returned HTML would
 * be asking every caller to trust markup it did not sanitize. A caller that has
 * an editor renders it with that editor; this app does not have one, so it walks
 * the tree and takes the words out.
 *
 * That is a perfectly good answer for a reader, and a lossy one for an editor:
 * the structure is mostly gone, and nothing could be written back. It is what
 * "curated, and deliberately small" means in practice — the API hands over the
 * document the author wrote and lets the caller decide what to do with it.
 */
export function notesToText(document: NotesDocument | undefined): string {
  if (!document) return '';

  const paragraphs: string[] = [];
  let current = '';

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { type?: string; text?: string; content?: unknown[] };

    if (typeof record.text === 'string') {
      current += record.text;
      return;
    }

    // A block boundary ends a paragraph; the inline marks inside one do not.
    const isBlock = BLOCK_TYPES.has(record.type ?? '');

    for (const child of record.content ?? []) walk(child);

    if (isBlock) {
      const text = current.trim();
      if (text) paragraphs.push(text);
      current = '';
    }
  };

  walk(document);

  const trailing = current.trim();
  if (trailing) paragraphs.push(trailing);

  return paragraphs.join('\n\n');
}

/**
 * The node types that end a paragraph.
 *
 * An allow-list rather than a deny-list, and short on purpose: a node this app
 * has never heard of is treated as inline, so an unrecognised wrapper costs a
 * paragraph break rather than the text inside it.
 */
const BLOCK_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'codeBlock',
  'horizontalRule',
]);
