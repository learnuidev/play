import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { NotesDocument } from '@/types';

/**
 * Renders lesson notes.
 *
 * The notes are a ProseMirror document, so they are rendered by walking the
 * tree and returning elements — never by handing markup to the browser. That is
 * the whole reason the API stores a document rather than an HTML string: there
 * is no `dangerouslySetInnerHTML` here to get wrong, and an unknown node type
 * renders its children as prose instead of executing anything.
 */

interface ProseMirrorNode {
  type?: string;
  text?: string;
  content?: ProseMirrorNode[];
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

/** Link targets an author is allowed to point at. */
const SAFE_LINK_SCHEME = /^(https?:\/\/|mailto:|tel:)/i;

function safeHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  const trimmed = href.trim();
  return SAFE_LINK_SCHEME.test(trimmed) ? trimmed : undefined;
}

/** Applies the marks on a text node, outermost first. */
function renderText(node: ProseMirrorNode, key: number): ReactNode {
  let element: ReactNode = node.text ?? '';

  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        element = <strong>{element}</strong>;
        break;
      case 'italic':
        element = <em>{element}</em>;
        break;
      case 'underline':
        element = <u>{element}</u>;
        break;
      case 'strike':
        element = <s>{element}</s>;
        break;
      case 'code':
        element = <code>{element}</code>;
        break;
      case 'link': {
        const href = safeHref(mark.attrs?.href);
        if (href) {
          element = (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {element}
            </a>
          );
        }
        break;
      }
      default:
        // An unknown mark decorates nothing; the words still show.
        break;
    }
  }

  return <Fragment key={key}>{element}</Fragment>;
}

function renderNodes(nodes: ProseMirrorNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((node, index) => renderNode(node, index));
}

function renderNode(node: ProseMirrorNode, key: number): ReactNode {
  if (node.type === 'text') return renderText(node, key);

  const children = renderNodes(node.content);

  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'heading': {
      // Only the levels the editor offers are reachable; anything else is a
      // paragraph rather than an <h7>.
      const level = Number(node.attrs?.level ?? 2);
      if (level === 1) return <h1 key={key}>{children}</h1>;
      if (level === 3) return <h3 key={key}>{children}</h3>;
      return <h2 key={key}>{children}</h2>;
    }
    case 'bulletList':
      return <ul key={key}>{children}</ul>;
    case 'orderedList':
      return <ol key={key}>{children}</ol>;
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>;
    case 'codeBlock': {
      // A code block's content is text, so its children are already plain.
      const code = (node.content ?? []).map((child) => child.text ?? '').join('');
      return (
        <pre key={key}>
          <code>{code}</code>
        </pre>
      );
    }
    case 'horizontalRule':
      return <hr key={key} />;
    case 'hardBreak':
      return <br key={key} />;
    case 'doc':
      return <Fragment key={key}>{children}</Fragment>;
    default:
      // An unknown block (a node type this build does not know) renders its
      // children rather than disappearing.
      return <Fragment key={key}>{children}</Fragment>;
  }
}

export function NotesView({ notes, className }: { notes?: NotesDocument; className?: string }) {
  const doc = notes as ProseMirrorNode | undefined;
  if (!doc) return null;

  return <div className={cn('prose-notes text-sm', className)}>{renderNode(doc, 0)}</div>;
}
