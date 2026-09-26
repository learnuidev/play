'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  CirclePlayIcon,
  HeartIcon,
  ListVideoIcon,
  Loader2Icon,
  MessageSquareIcon,
  PaperclipIcon,
  PencilIcon,
  Trash2Icon,
  VideoOffIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDuration } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { ContentDetailsDialog } from '@/components/content/content-details-dialog';
import { ContentFiles } from '@/components/content/content-files';
import { NotesEditor } from '@/components/content/notes-editor';
import { isEmptyNotes } from '@/components/content/notes';
import { NotesView } from '@/components/content/notes-view';
import { VideoThumbnail } from '@/components/video/video-thumbnail';
import { VideoStatusBadge } from '@/components/video/status-badge';
import { useContent, useDeleteContent, useUpdateContent } from '@/modules/content/content.queries';
import { useOrganization } from '@/modules/organization/organization.queries';
import { useVideo } from '@/modules/video/video.queries';
import { useSection } from '@/modules/section/section.queries';
import { CONTENT_TYPE_LABELS, type Content, type NotesDocument } from '@/types';

/**
 * The video a lesson plays, as a card that leads to the player.
 *
 * Playback itself lives with every other video — the player, the synced
 * transcript, the audio-only mode — so a lesson links there rather than growing
 * a second way to watch the same manifest.
 */
function LinkedVideo({ orgId, videoId }: { orgId: string; videoId: string }) {
  const { data, isLoading } = useVideo(videoId);
  const video = data?.video;

  if (isLoading) return <Skeleton className="h-24 rounded-xl" />;

  if (!video) {
    return (
      <p className="rounded-xl border border-dashed px-3 py-6 text-sm text-muted-foreground">
        This lesson points at a video that is no longer in the library.
      </p>
    );
  }

  return (
    <Link
      href={`/o/${orgId}/videos/${video.videoId}/preview`}
      className="flex items-center gap-3 rounded-xl border bg-background p-3 transition-colors hover:border-ring/50"
    >
      <VideoThumbnail video={video} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{video.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <VideoStatusBadge status={video.status} />
          {video.duration ? <span>{formatDuration(video.duration)}</span> : null}
        </span>
      </span>
      <CirclePlayIcon className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** The counts a lesson carries. The classroom is what makes them interactive. */
function Counters({ content }: { content: Content }) {
  const items = [
    { icon: PaperclipIcon, value: content.fileCount, label: 'files' },
    { icon: HeartIcon, value: content.favouriteCount, label: 'favourites' },
    { icon: MessageSquareIcon, value: content.commentCount, label: 'comments' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {items.map(({ icon: Icon, value, label }) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {value} {label}
        </span>
      ))}
    </div>
  );
}

/** The notes, rendered; and the editor that replaces them while they are edited. */
function NotesSection({ content, spaceId, canEdit }: { content: Content; spaceId: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NotesDocument | undefined>(content.notes);
  const update = useUpdateContent(content.contentId, spaceId);

  const hasNotes = !isEmptyNotes(content.notes);

  async function save() {
    try {
      // An emptied editor clears the notes rather than storing an empty
      // document, so "no notes" has one representation.
      await update.mutateAsync({ notes: draft && !isEmptyNotes(draft) ? draft : null });
      toast.success('Notes saved');
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the notes');
    }
  }

  if (editing) {
    return (
      <div className="grid gap-3">
        <NotesEditor value={draft} onChange={setDraft} />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {update.isPending && <Loader2Icon className="animate-spin" />}
            Save notes
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(content.notes);
              setEditing(false);
            }}
            disabled={update.isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {hasNotes ? (
        <NotesView notes={content.notes} />
      ) : (
        <p className="text-sm italic text-muted-foreground">
          {canEdit ? 'No notes yet.' : 'No notes for this lesson.'}
        </p>
      )}

      {canEdit && (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(content.notes);
              setEditing(true);
            }}
          >
            <PencilIcon />
            {hasNotes ? 'Edit notes' : 'Write notes'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One lesson: its video, its notes, and its files. */
export default function ContentPage() {
  const { orgId, spaceId, contentId } = useParams<{
    orgId: string;
    spaceId: string;
    contentId: string;
  }>();
  const router = useRouter();

  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== 'VIEWER' : false;

  const { data, isLoading, isError, error } = useContent(contentId);
  const content = data?.content;

  // The section is only needed for the breadcrumb, so a missing one is not an
  // error — it just means the lesson is shown without its heading.
  const { data: sectionData } = useSection(content?.sectionId ?? '');

  const remove = useDeleteContent(spaceId);

  async function deleteContent() {
    if (!content) return;
    const confirmed = window.confirm(
      `Delete “${content.title}”? Its notes, files and comments go with it.`,
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(content.contentId);
      toast.success('Content deleted');
      router.push(`/o/${orgId}/spaces/${spaceId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the content');
    }
  }

  if (isError) {
    return (
      <PageCard title="Content">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load this content'}
        </p>
      </PageCard>
    );
  }

  if (isLoading || !content) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  const section = sectionData?.section;

  return (
    <div className="grid gap-6">
      <section className="overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col gap-4 p-5">
          <Button variant="ghost" size="sm" className="w-fit -ml-2" asChild>
            <Link href={`/o/${orgId}/spaces/${spaceId}`}>
              <ArrowLeftIcon />
              {section ? section.title : 'Back to space'}
            </Link>
          </Button>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">{content.title}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {CONTENT_TYPE_LABELS[content.type] ?? content.type}
              </p>
            </div>

            {canEdit && (
              <div className="flex shrink-0 items-center gap-2">
                <ContentDetailsDialog
                  orgId={orgId}
                  spaceId={spaceId}
                  content={content}
                  trigger={
                    <Button variant="outline" size="sm">
                      <PencilIcon />
                      Edit
                    </Button>
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={deleteContent}
                  disabled={remove.isPending}
                  aria-label="Delete content"
                >
                  {remove.isPending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                </Button>
              </div>
            )}
          </div>

          <Counters content={content} />
        </div>
      </section>

      <PageCard title="Video" description="What this lesson plays.">
        {content.videoId ? (
          <LinkedVideo orgId={orgId} videoId={content.videoId} />
        ) : (
          <EmptyState
            icon={<VideoOffIcon className="size-5 text-muted-foreground" />}
            title="No video linked"
            description={
              canEdit
                ? 'This lesson is written but has nothing to play yet. Link one of the organization’s videos.'
                : 'This lesson has no video yet.'
            }
            action={
              canEdit ? (
                <ContentDetailsDialog
                  orgId={orgId}
                  spaceId={spaceId}
                  content={content}
                  trigger={
                    <Button>
                      <ListVideoIcon />
                      Choose a video
                    </Button>
                  }
                />
              ) : undefined
            }
          />
        )}
      </PageCard>

      <PageCard title="Notes" description="The lesson, in the author’s own words.">
        <NotesSection content={content} spaceId={spaceId} canEdit={canEdit} />
      </PageCard>

      <PageCard title="Files" description="Material that goes with this lesson.">
        <ContentFiles contentId={content.contentId} canEdit={canEdit} />
      </PageCard>
    </div>
  );
}
