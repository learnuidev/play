import { HttpError } from './http';

/**
 * Field parsers shared by the handlers that create and edit a space's content.
 *
 * They live here rather than inline in each handler because the same four
 * fields — a title, a description, a position, and a notes document — are
 * validated on the way in from several routes, and a course's sections and
 * content should reject the same input for the same reason everywhere.
 */

export interface TitleRules {
  min: number;
  max: number;
  /** The field's name in error messages, e.g. `title`. */
  field?: string;
}

/**
 * Validates a required title and returns it collapsed: internal runs of
 * whitespace become a single space, so a title typed with stray spaces is the
 * same title as one typed without them.
 */
export function parseTitle(raw: unknown, rules: TitleRules): string {
  const field = rules.field ?? 'title';
  if (typeof raw !== 'string') throw new HttpError(400, `${field} is required`);

  const title = raw.trim().replace(/\s+/g, ' ');
  if (!title) throw new HttpError(400, `${field} is required`);
  if (title.length < rules.min) {
    throw new HttpError(400, `${field} must be at least ${rules.min} characters`);
  }
  if (title.length > rules.max) {
    throw new HttpError(400, `${field} must be <= ${rules.max} characters`);
  }
  return title;
}

/** Validates an optional free-text field and returns it trimmed. */
export function parseText(raw: unknown, max: number, field: string): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new HttpError(400, `${field} must be a string`);

  const value = raw.trim();
  if (value.length > max) {
    throw new HttpError(400, `${field} must be <= ${max} characters`);
  }
  return value;
}

/**
 * Validates an ordering position. Gaps are legal — swapping two neighbours
 * writes two positions rather than renumbering everything between them — so any
 * positive whole number is accepted.
 */
export function parsePosition(raw: unknown, field = 'position'): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new HttpError(400, `${field} must be a whole number >= 1`);
  }
  return raw;
}

/** Size ceiling for a notes document, well inside DynamoDB's 400 KB item limit. */
export const MAX_NOTES_BYTES = 100 * 1024;

/**
 * Validates a notes document.
 *
 * Notes are a TipTap/ProseMirror document, not HTML: the frontend renders the
 * tree node by node, so nothing authored here is ever parsed as markup. The
 * shape check is deliberately shallow — it is a boundary, not a schema — but it
 * does insist on an object, which is what stops a string of HTML from being
 * stored as if it were a document.
 */
export function parseNotes(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError(400, 'notes must be a ProseMirror document object');
  }

  const notes = raw as Record<string, unknown>;
  if (notes.type !== 'doc') {
    throw new HttpError(400, 'notes must be a ProseMirror document (type: "doc")');
  }

  const size = Buffer.byteLength(JSON.stringify(notes), 'utf8');
  if (size > MAX_NOTES_BYTES) {
    throw new HttpError(413, `notes must be <= ${MAX_NOTES_BYTES} bytes`);
  }
  return notes;
}

/** Validates a BCP-47-ish language-free MIME type, e.g. `application/pdf`. */
export function parseContentType(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new HttpError(400, 'contentType is required');
  }
  return raw.trim().toLowerCase();
}

/** Validates a comment body and returns it trimmed. */
export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 2000;

export function parseCommentBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'body is required');

  const body = raw.trim();
  if (body.length < MIN_COMMENT_LENGTH) throw new HttpError(400, 'body is required');
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new HttpError(400, `body must be <= ${MAX_COMMENT_LENGTH} characters`);
  }
  return body;
}
