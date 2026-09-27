'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The notes editor, loaded only once a lesson's notes are actually being
 * written.
 *
 * TipTap and ProseMirror are a large dependency for a page that is mostly read,
 * so they arrive in a chunk of their own the first time one of these opens
 * rather than with every page that could open one — and never on the server,
 * where a ProseMirror view has nothing to attach to.
 */
export const NotesEditor = dynamic(
  () => import('./rich-text-editor').then((mod) => mod.RichTextEditor),
  { ssr: false, loading: () => <Skeleton className="h-48 rounded-md" /> },
);
