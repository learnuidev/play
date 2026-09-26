'use client';

import Link from 'next/link';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  HeartIcon,
  ListVideoIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/shell/page-card';
import { ContentDialog } from './content-dialog';
import { SectionDialog } from './section-dialog';
import { useDeleteContent, useUpdateContent } from '@/modules/content/content.queries';
import { useDeleteSection, useUpdateSection } from '@/modules/section/section.queries';
import { CONTENT_TYPE_LABELS, type Content, type Section, type SectionWithContents } from '@/types';

/**
 * Works out which two rows a move is between.
 *
 * Order is stored as a position on each row rather than as a list, so moving one
 * step is a swap of two positions. Sparse positions are what make that cheap:
 * nothing between the neighbours has to be renumbered.
 */
function neighbours<T>(items: T[], index: number, direction: -1 | 1): { from: T; to: T } | null {
  const target = index + direction;
  if (target < 0 || target >= items.length) return null;
  return { from: items[index], to: items[target] };
}

/** The counts a lesson carries, shown as icons so a row stays one line. */
function ContentMeta({ content }: { content: Content }) {
  return (
    <span className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1" title={`${content.fileCount} files`}>
        <PaperclipIcon className="size-3.5" />
        {content.fileCount}
      </span>
      <span className="inline-flex items-center gap-1" title={`${content.favouriteCount} favourites`}>
        <HeartIcon className="size-3.5" />
        {content.favouriteCount}
      </span>
      <span className="inline-flex items-center gap-1" title={`${content.commentCount} comments`}>
        <MessageSquareIcon className="size-3.5" />
        {content.commentCount}
      </span>
    </span>
  );
}

/** One lesson in a section: what it is, and what has been put in it. */
function ContentRow({
  orgId,
  spaceId,
  content,
  siblings,
  index,
  canEdit,
}: {
  orgId: string;
  spaceId: string;
  content: Content;
  siblings: Content[];
  index: number;
  canEdit: boolean;
}) {
  const update = useUpdateContent(content.contentId, spaceId);
  const remove = useDeleteContent(spaceId);

  const move = neighbours(siblings, index, -1);
  const moveDown = neighbours(siblings, index, 1);

  async function swap(target: Content) {
    try {
      await Promise.all([
        update.mutateAsync({ position: target.position }),
        update.mutateAsync({ position: content.position }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder');
    }
  }

  async function deleteContent() {
    const confirmed = window.confirm(
      `Delete “${content.title}”? Its notes, files and comments go with it.`,
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(content.contentId);
      toast.success('Content deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the content');
    }
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border bg-background px-3 py-2 transition-colors hover:border-ring/40">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {content.videoId ? <PlayIcon className="size-4" /> : <FileTextIcon className="size-4" />}
      </span>

      <Link href={`/o/${orgId}/spaces/${spaceId}/contents/${content.contentId}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{content.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{CONTENT_TYPE_LABELS[content.type] ?? content.type}</span>
          {!content.videoId && <span className="text-amber-600 dark:text-amber-500">No video linked</span>}
          <ContentMeta content={content} />
        </span>
      </Link>

      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100" aria-label="Content actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!move} onClick={() => move && swap(move.to)}>
              <ChevronUpIcon />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!moveDown} onClick={() => moveDown && swap(moveDown.to)}>
              <ChevronDownIcon />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={deleteContent}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** A section of a course: its heading, and the lessons filed under it. */
function SectionBlock({
  orgId,
  spaceId,
  section,
  siblings,
  index,
  canEdit,
}: {
  orgId: string;
  spaceId: string;
  section: SectionWithContents;
  siblings: SectionWithContents[];
  index: number;
  canEdit: boolean;
}) {
  const update = useUpdateSection(spaceId, section.sectionId);
  const remove = useDeleteSection(spaceId);

  const up = neighbours(siblings, index, -1);
  const down = neighbours(siblings, index, 1);

  async function swap(target: Section) {
    try {
      await Promise.all([
        update.mutateAsync({ position: target.position }),
        update.mutateAsync({ position: section.position }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder');
    }
  }

  async function deleteSection() {
    const count = section.contents.length;
    const confirmed = window.confirm(
      count === 0
        ? `Delete the section “${section.title}”?`
        : `Delete “${section.title}” and the ${count} piece${count === 1 ? '' : 's'} of content in it?`,
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(section.sectionId);
      toast.success('Section deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the section');
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <header className="flex items-start gap-3 border-b bg-muted/30 px-4 py-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold text-muted-foreground">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{section.title}</h2>
          {section.description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{section.description}</p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {section.contents.length === 0
                ? 'Nothing in this section yet'
                : `${section.contents.length} piece${section.contents.length === 1 ? '' : 's'} of content`}
            </p>
          )}
        </div>

        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <SectionDialog
              spaceId={spaceId}
              section={section}
              trigger={
                <Button variant="ghost" size="icon" className="size-8" aria-label="Edit section">
                  <PencilIcon />
                </Button>
              }
            />
            <ContentDialog
              orgId={orgId}
              spaceId={spaceId}
              sectionId={section.sectionId}
              sectionTitle={section.title}
              trigger={
                <Button variant="outline" size="sm">
                  <PlusIcon />
                  Add content
                </Button>
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="Section actions">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem disabled={!up} onClick={() => up && swap(up.to)}>
                  <ChevronUpIcon />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!down} onClick={() => down && swap(down.to)}>
                  <ChevronDownIcon />
                  Move down
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={deleteSection}>
                  <Trash2Icon />
                  Delete section
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <div className="grid gap-2 p-3">
        {section.contents.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {canEdit ? 'Add the first piece of content to this section.' : 'Nothing published here yet.'}
          </p>
        ) : (
          section.contents.map((content, contentIndex) => (
            <ContentRow
              key={content.contentId}
              orgId={orgId}
              spaceId={spaceId}
              content={content}
              siblings={section.contents}
              index={contentIndex}
              canEdit={canEdit}
            />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * A space's content, section by section.
 *
 * This is the outline an author arranges and a member reads: sections in the
 * order they were put in, each holding its content in the order it was put in.
 * An admin or editor gets the controls; a viewer gets the same page without
 * them.
 */
export function ContentOutline({
  orgId,
  spaceId,
  sections,
  truncated,
  canEdit,
}: {
  orgId: string;
  spaceId: string;
  sections: SectionWithContents[];
  truncated: boolean;
  canEdit: boolean;
}) {
  if (sections.length === 0) {
    return (
      <EmptyState
        icon={<ListVideoIcon className="size-5 text-muted-foreground" />}
        title="Nothing in this space yet"
        description={
          canEdit
            ? 'A space holds sections, and each section holds its content. Start with a section.'
            : 'Nothing has been published to this space yet.'
        }
        action={
          canEdit ? (
            <SectionDialog
              spaceId={spaceId}
              trigger={
                <Button>
                  <PlusIcon />
                  New section
                </Button>
              }
            />
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      {truncated && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          This course is larger than one page reads, so the outline stops here. The rest is still
          there — content is reachable from its own section.
        </p>
      )}

      {sections.map((section, index) => (
        <SectionBlock
          key={section.sectionId}
          orgId={orgId}
          spaceId={spaceId}
          section={section}
          siblings={sections}
          index={index}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}
