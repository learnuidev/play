'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  FileTextIcon,
  HeartIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';
import { ContentDialog } from './content-dialog';
import { SectionDialog } from './section-dialog';
import { useDeleteContent, useUpdateContent } from '@api/modules/content/content.queries';
import { useDeleteSection, useUpdateSection } from '@api/modules/section/section.queries';
import { useLearningRoutes } from '@learning/lib/learning-routes';
import type { Content, Section, SectionWithContents } from '@play/types';

/**
 * The outline, as a list rather than a stack of boxes.
 *
 * Everything here is one surface: hairlines and indentation say what belongs to
 * what, so nothing is nested inside a border of its own. The controls an author
 * needs are the quietest thing on the page — a menu that appears on the row you
 * are pointing at, and one always-visible "add" line per section — because a
 * course is read far more often than it is edited.
 */

/** Works out which two rows a move is between: a move is a swap of two positions. */
function neighbours<T>(items: T[], index: number, direction: -1 | 1): { from: T; to: T } | null {
  const target = index + direction;
  if (target < 0 || target >= items.length) return null;
  return { from: items[index], to: items[target] };
}

/** Small, quiet controls that only speak when pointed at. */
const QUIET_CONTROL =
  'size-7 shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:opacity-100';

/** What a lesson has in it. Counts of nothing are left out rather than shown as zero. */
function ContentStats({ content }: { content: Content }) {
  const stats = [
    { key: 'files', icon: PaperclipIcon, value: content.fileCount, label: 'files' },
    { key: 'favourites', icon: HeartIcon, value: content.favouriteCount, label: 'favourites' },
    { key: 'comments', icon: MessageSquareIcon, value: content.commentCount, label: 'comments' },
  ].filter((stat) => stat.value > 0);

  if (stats.length === 0) return null;

  return (
    <>
      {stats.map(({ key, icon: Icon, value, label }) => (
        <span key={key} className="inline-flex items-center gap-1" title={`${value} ${label}`}>
          <Icon className="size-3" />
          <span className="tabular-nums">{value}</span>
        </span>
      ))}
    </>
  );
}

/** One lesson: a row you open, with what it holds stated quietly beside it. */
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
  const routes = useLearningRoutes();
  const update = useUpdateContent(content.contentId, spaceId);
  const remove = useDeleteContent(spaceId);

  const up = neighbours(siblings, index, -1);
  const down = neighbours(siblings, index, 1);

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
    <li className="group/row flex items-center rounded-lg transition-colors hover:bg-background">
      <Link
        href={routes.lesson(spaceId, content.contentId)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-2"
      >
        <span className="flex w-4 shrink-0 justify-center text-muted-foreground/70">
          {content.videoId ? <PlayIcon className="size-3.5" /> : <FileTextIcon className="size-3.5" />}
        </span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium">{content.title}</span>

        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          {!content.videoId && (
            <span className="hidden font-medium text-amber-600 sm:inline dark:text-amber-500">
              No video
            </span>
          )}
          <ContentStats content={content} />
        </span>

        {/* A list that opens says so, the way every list you already know does. */}
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover/row:text-muted-foreground" />
      </Link>

      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(QUIET_CONTROL, 'mr-1 opacity-0 group-hover/row:opacity-100 max-sm:opacity-100')}
              aria-label={`Actions for ${content.title}`}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!up} onClick={() => up && swap(up.to)}>
              <ChevronUpIcon />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!down} onClick={() => down && swap(down.to)}>
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
    </li>
  );
}

/** A section: its heading, the lessons under it, and a line to add another. */
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
  const [renaming, setRenaming] = useState(false);

  const update = useUpdateSection(spaceId, section.sectionId);
  const remove = useDeleteSection(spaceId);

  const up = neighbours(siblings, index, -1);
  const down = neighbours(siblings, index, 1);
  const lessons = section.contents.length;

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
    const confirmed = window.confirm(
      lessons === 0
        ? `Delete the section “${section.title}”?`
        : `Delete “${section.title}” and the ${lessons} piece${lessons === 1 ? '' : 's'} of content in it?`,
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
    <section className="group/section border-t border-border/60 py-5 first:border-t-0 first:pt-1">
      <header className="flex items-center gap-3">
        <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-muted-foreground/60">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
          {section.title}
        </h3>
        {lessons > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {lessons} lesson{lessons === 1 ? '' : 's'}
          </span>
        )}

        {canEdit && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    QUIET_CONTROL,
                    '-mr-1 opacity-0 group-hover/section:opacity-100 group-focus-within/section:opacity-100 max-sm:opacity-100',
                  )}
                  aria-label={`Actions for ${section.title}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {/* The menu closes before this opens: a dialog inside a menu item
                    fights the menu for focus. */}
                <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>
                  Rename section
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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

            <SectionDialog
              spaceId={spaceId}
              section={section}
              open={renaming}
              onOpenChange={setRenaming}
            />
          </>
        )}
      </header>

      {section.description && (
        <p className="mt-1 pl-7 text-[13px] leading-relaxed text-muted-foreground">
          {section.description}
        </p>
      )}

      <ul className="mt-1.5 grid gap-0.5 pl-5">
        {section.contents.map((content, contentIndex) => (
          <ContentRow
            key={content.contentId}
            orgId={orgId}
            spaceId={spaceId}
            content={content}
            siblings={section.contents}
            index={contentIndex}
            canEdit={canEdit}
          />
        ))}

        {canEdit && (
          <li>
            <ContentDialog
              orgId={orgId}
              spaceId={spaceId}
              sectionId={section.sectionId}
              sectionTitle={section.title}
              trigger={
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg py-2 pl-2 text-left text-sm text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground"
                >
                  <span className="flex w-4 shrink-0 justify-center">
                    <PlusIcon className="size-3.5" />
                  </span>
                  Add content
                </button>
              }
            />
          </li>
        )}

        {!canEdit && lessons === 0 && (
          <li className="py-2 pl-2 text-sm text-muted-foreground">Nothing published here yet.</li>
        )}
      </ul>
    </section>
  );
}

/** The quiet block a course page shows before anything has been put in it. */
function NothingYet({ spaceId, canEdit }: { spaceId: string; canEdit: boolean }) {
  return (
    <div className="grid justify-items-center gap-3 py-16 text-center">
      <p className="text-[15px] font-medium">No sections yet</p>
      <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
        {canEdit
          ? 'A section is a heading over the lessons that follow it.'
          : 'Nothing has been published to this space yet.'}
      </p>
      {canEdit && (
        <SectionDialog
          spaceId={spaceId}
          trigger={
            <Button variant="outline" size="sm" className="mt-1">
              <PlusIcon />
              New section
            </Button>
          }
        />
      )}
    </div>
  );
}

/**
 * A space's content, section by section.
 *
 * This is the outline an author arranges and a member reads: sections in the
 * order they were put in, each holding its content in the order it was put in.
 * An admin or editor gets the controls; a viewer gets the same list without
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
    return <NothingYet spaceId={spaceId} canEdit={canEdit} />;
  }

  return (
    <div>
      {truncated && (
        <p className="pb-3 text-[13px] text-muted-foreground">
          This course is larger than one page reads, so the outline stops here. Every lesson still
          opens from its own section.
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
