'use client';

import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  SquareCodeIcon,
  StrikethroughIcon,
  UnderlineIcon,
  Undo2Icon,
} from 'lucide-react';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import { EMPTY_NOTES } from './notes';
import type { NotesDocument } from '@play/types';

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="icon"
      className="size-8"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const promptLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous ?? 'https://');
    if (url === null) return;
    // An empty answer unsets the link rather than pointing it at nothing.
    if (!url.trim()) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 p-1">
      <ToolbarButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <BoldIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <StrikethroughIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <CodeIcon className="size-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border" />

      <ToolbarButton
        label="Heading"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2Icon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Subheading"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3Icon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Bulleted list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrderedIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <QuoteIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <SquareCodeIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <MinusIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Link" active={editor.isActive('link')} onClick={promptLink}>
        <LinkIcon className="size-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border" />

      <ToolbarButton
        label="Undo"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2Icon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2Icon className="size-4" />
      </ToolbarButton>
    </div>
  );
}

/**
 * The lesson notes editor.
 *
 * It reads and writes a ProseMirror document rather than HTML: what is stored
 * is the same tree the editor works on, so the notes are rendered later by
 * mapping nodes to elements instead of by handing markup to the browser. The
 * editor is uncontrolled after mount — `value` only seeds it, and changes come
 * back out through `onChange` — because re-seeding a ProseMirror view on every
 * keystroke is how a rich text editor loses its cursor.
 */
export function RichTextEditor({
  value,
  onChange,
  className,
}: {
  value?: NotesDocument;
  onChange: (notes: NotesDocument) => void;
  className?: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value ?? EMPTY_NOTES,
    // The app is server-rendered; letting TipTap render on the server too is
    // what produces a hydration mismatch here.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose-notes min-h-40 px-3 py-2 text-sm focus:outline-none',
      },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getJSON() as NotesDocument),
  });

  // A different document (switching from one lesson to another) re-seeds the
  // editor. Comparing serialized forms keeps an unrelated re-render from
  // resetting the cursor.
  const serialized = JSON.stringify(value ?? EMPTY_NOTES);
  useEffect(() => {
    if (!editor) return;
    if (JSON.stringify(editor.getJSON()) === serialized) return;
    editor.commands.setContent(JSON.parse(serialized) as NotesDocument);
    // `editor` is stable for the life of the component; the document is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, editor]);

  if (!editor) {
    return <div className={cn('h-48 rounded-md border bg-muted/20', className)} />;
  }

  return (
    <div className={cn('overflow-hidden rounded-md border', className)}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
