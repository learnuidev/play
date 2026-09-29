'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  FileTextIcon,
  GripVerticalIcon,
  HeartIcon,
  HelpCircleIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import { useDeleteContent, usePlaceContent, useUpdateContent } from '@api/modules/content/content.queries';
import { useDeleteSection, useUpdateSection } from '@api/modules/section/section.queries';
import { useLearningRoutes } from '@learning/lib/learning-routes';
import type { Content, Section, SectionWithContents } from '@play/types';

/**
 * The outline, as a list rather than a stack of boxes.
 *
 * Everything here is one surface: hairlines and indentation say what belongs to
 * what, so nothing is nested inside a border of its own. The controls an author
 * needs are the quietest thing on the page — a handle on the row you are
 * pointing at, a menu beside it, and one always-visible "add" line per section —
 * because a course is read far more often than it is edited.
 *
 * ## Sorting
 *
 * A lesson is dragged by its handle and dropped where it belongs, including into
 * another section. What the drop *sends* is a place, not an order: "this lesson,
 * in that section, at that index" — and the server works out the resulting
 * numbering from what the section currently holds. A page that sent the whole
 * order it is looking at would overwrite a lesson somebody else added while this
 * drag was in flight, and an index stays true where a list of ids does not.
 */

/** The two kinds of drop target that are not a row: a section, and its end. */
const SECTION_PREFIX = 'section:';
const END_PREFIX = 'end:';

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

/** The mark saying what a row is: a lesson you watch, or a quiz you are asked. */
function ContentIcon({ content }: { content: Content }) {
  if (content.type === 'QUIZ') return <HelpCircleIcon className="size-3.5" />;
  return content.videoId ? <PlayIcon className="size-3.5" /> : <FileTextIcon className="size-3.5" />;
}

/** One lesson or quiz: a row you open, with what it holds stated quietly beside it. */
function ContentRow({
  orgId,
  spaceId,
  content,
  siblings,
  index,
  canEdit,
  dragging,
}: {
  orgId: string;
  spaceId: string;
  content: Content;
  siblings: Content[];
  index: number;
  canEdit: boolean;
  dragging: boolean;
}) {
  const routes = useLearningRoutes();
  const update = useUpdateContent(content.contentId, spaceId);
  const remove = useDeleteContent(spaceId);

  // Only rows can be picked up; the sections around them are what a row is
  // dropped *into*, which is why a section is a drop target and not a sortable.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: content.contentId,
    data: { sectionId: content.sectionId },
    disabled: !canEdit,
  });

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
      content.type === 'QUIZ'
        ? `Delete the quiz “${content.title}”? Its questions go with it.`
        : `Delete “${content.title}”? Its notes, files and comments go with it.`,
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(content.contentId);
      toast.success(content.type === 'QUIZ' ? 'Quiz deleted' : 'Content deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the content');
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/row flex items-center rounded-lg transition-colors hover:bg-background',
        (isDragging || dragging) && 'opacity-40',
      )}
    >
      {canEdit && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${content.title}`}
          className="ml-0.5 flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/0 transition-colors group-hover/row:text-muted-foreground/50 hover:text-foreground focus-visible:text-muted-foreground active:cursor-grabbing max-sm:text-muted-foreground/40"
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
      )}

      <Link
        href={routes.lesson(spaceId, content.contentId)}
        className={cn('flex min-w-0 flex-1 items-center gap-3 py-2', canEdit ? 'pl-1' : 'pl-2')}
      >
        <span className="flex w-4 shrink-0 justify-center text-muted-foreground/70">
          <ContentIcon content={content} />
        </span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium">{content.title}</span>

        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          {content.type === 'QUIZ' && <span className="font-medium">Quiz</span>}
          {content.type === 'VIDEO' && !content.videoId && (
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
  isDropTarget,
}: {
  orgId: string;
  spaceId: string;
  section: SectionWithContents;
  siblings: SectionWithContents[];
  index: number;
  canEdit: boolean;
  isDropTarget: boolean;
}) {
  const [renaming, setRenaming] = useState(false);

  const update = useUpdateSection(spaceId, section.sectionId);
  const remove = useDeleteSection(spaceId);

  /**
   * The section itself is a drop target, which is what makes an *empty* one
   * reachable: a section with nothing in it has no rows to drop between, and a
   * lesson dragged into it has to land somewhere.
   */
  const { setNodeRef } = useDroppable({ id: `${SECTION_PREFIX}${section.sectionId}`, disabled: !canEdit });

  /** The line below the last row: dropping there is dropping at the end. */
  const { setNodeRef: setEndRef, isOver: isOverEnd } = useDroppable({
    id: `${END_PREFIX}${section.sectionId}`,
    disabled: !canEdit,
  });

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
    <section
      ref={setNodeRef}
      className={cn(
        'group/section border-t border-border/60 py-5 first:border-t-0 first:pt-1',
        // A drag in progress says which section it would land in, quietly: the
        // alternative is finding out by dropping.
        isDropTarget && 'bg-primary/[0.03]',
      )}
    >
      <header className="flex items-center gap-3">
        <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-muted-foreground/60">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {section.title}
        </h3>
        {lessons > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {lessons} item{lessons === 1 ? '' : 's'}
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
        <p className="mt-1 pl-7 text-xs leading-relaxed text-muted-foreground">
          {section.description}
        </p>
      )}

      <ul className="mt-1.5 grid gap-0.5 pl-5">
        <SortableContext
          items={section.contents.map((content) => content.contentId)}
          strategy={verticalListSortingStrategy}
        >
          {section.contents.map((content, contentIndex) => (
            <ContentRow
              key={content.contentId}
              orgId={orgId}
              spaceId={spaceId}
              content={content}
              siblings={section.contents}
              index={contentIndex}
              canEdit={canEdit}
              dragging={false}
            />
          ))}
        </SortableContext>

        {canEdit && (
          <li ref={setEndRef} className={cn('rounded-lg', isOverEnd && 'bg-primary/[0.03]')}>
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
      <p className="text-base font-medium">No sections yet</p>
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
        {canEdit
          ? 'A section is a heading over the lessons and quizzes that follow it.'
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
 * An admin or editor gets the controls and the handles; a viewer gets the same
 * list without them.
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
  const place = usePlaceContent(spaceId);
  const [dragging, setDragging] = useState<Content | null>(null);
  const [overSectionId, setOverSectionId] = useState<string | null>(null);

  const sensors = useSensors(
    // A few pixels before a drag starts, so a click that wobbles is still a
    // click on the lesson rather than a failed drag of it.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Where a piece of content is, by its id. */
  function locate(contentId: string): { sectionId: string; index: number } | null {
    for (const section of sections) {
      const index = section.contents.findIndex((content) => content.contentId === contentId);
      if (index !== -1) return { sectionId: section.sectionId, index };
    }
    return null;
  }

  /**
   * Which droppable the pointer is over.
   *
   * Rows win over the section that contains them — the section's rectangle
   * covers all of its rows, so `closestCenter` over both would answer with the
   * container half the time and drop every lesson at the end of a section. Only
   * when no row is near — an empty section, or the space below the last one —
   * does the section itself answer.
   */
  const collisionDetection: CollisionDetection = (args) => {
    const rows = args.droppableContainers.filter((container) => {
      const id = String(container.id);
      return !id.startsWith(SECTION_PREFIX);
    });

    const nearest = closestCenter({ ...args, droppableContainers: rows });
    return nearest.length > 0 ? nearest : closestCenter(args);
  };

  /**
   * A drop: the place it landed is the place the server is told.
   *
   * The index is the moved row's position in the list as it will look — before
   * the row it was dropped on when moving up, after it when moving down, which
   * is what `arrayMove` produces and therefore what the reader saw while
   * dragging. The server renumbers from what the section holds *now*, so a
   * lesson added while this drag was in flight is not lost by it.
   */
  async function handleDragEnd(event: DragEndEvent) {
    const content = dragging;
    setDragging(null);
    setOverSectionId(null);

    if (!content) return;

    const { over } = event;
    if (!over) return;

    const overId = String(over.id);
    const from = locate(content.contentId);

    let targetSectionId: string;
    let index: number;

    if (overId.startsWith(SECTION_PREFIX) || overId.startsWith(END_PREFIX)) {
      targetSectionId = overId.slice(overId.indexOf(':') + 1);
      const target = sections.find((section) => section.sectionId === targetSectionId);
      if (!target) return;
      // Dropping on the section itself, or on its "add" line, means the end of
      // its list — which is where the space below the last row is.
      index = target.contents.filter((entry) => entry.contentId !== content.contentId).length;
    } else {
      const target = locate(overId);
      if (!target) return;
      targetSectionId = target.sectionId;
      index = target.index;

      // Dropping a row onto itself is not a move.
      if (overId === content.contentId) return;
    }

    if (from && from.sectionId === targetSectionId && from.index === index) return;

    try {
      await place.mutateAsync({ contentId: content.contentId, sectionId: targetSectionId, index });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move it');
    }
  }

  /** Which section the drag is currently over, so it can say so. */
  function handleDragOver(event: DragOverEvent) {
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      setOverSectionId(null);
      return;
    }

    if (overId.startsWith(SECTION_PREFIX) || overId.startsWith(END_PREFIX)) {
      setOverSectionId(overId.slice(overId.indexOf(':') + 1));
      return;
    }

    setOverSectionId(locate(overId)?.sectionId ?? null);
  }

  if (sections.length === 0) {
    return <NothingYet spaceId={spaceId} canEdit={canEdit} />;
  }

  const body = (
    <>
      {truncated && (
        <p className="pb-3 text-xs text-muted-foreground">
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
          isDropTarget={overSectionId === section.sectionId && Boolean(dragging)}
        />
      ))}
    </>
  );

  // A viewer's outline is a list, not a workspace: no sensors, no context to
  // find a drop target in.
  if (!canEdit) return <div>{body}</div>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(event: DragStartEvent) => {
        const found = sections
          .flatMap((section) => section.contents)
          .find((content) => content.contentId === event.active.id);
        setDragging(found ?? null);
      }}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setOverSectionId(null);
      }}
    >
      {body}

      <DragOverlay>
        {dragging && (
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2 shadow-lg">
            <span className="flex w-4 shrink-0 justify-center text-muted-foreground/70">
              <ContentIcon content={dragging} />
            </span>
            <span className="text-sm font-medium">{dragging.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
