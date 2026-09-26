"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeftIcon,
  HeartIcon,
  Loader2Icon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PencilIcon,
  Trash2Icon,
  VideoOffIcon,
} from "lucide-react";
import { toast } from "sonner";
import { parseVtt } from "@/lib/vtt";
import { buildTranscriptLines } from "@/lib/transcript";
import { findNextWatchable } from "@/lib/course";
import { linesInRange, snapRangeToLines, transcriptTextFor } from "@/lib/transcript";
import { useLoopPlayback } from "@/hooks/use-loop-playback";
import { usePlayingNext } from "@/hooks/use-playing-next";
import { useTranscriptLines } from "@/hooks/use-transcript-lines";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnimatedTranscript } from "@/components/content/animated-transcript";
import { ContentDetailsDialog } from "@/components/content/content-details-dialog";
import { ContentFiles } from "@/components/content/content-files";
import { ContentLoops } from "@/components/content/content-loops";
import {
  DEFAULT_LOOP_SECONDS,
  LoopBar,
  type LoopRange,
} from "@/components/content/loop-bar";
import { NotesEditor } from "@/components/content/notes-editor";
import { isEmptyNotes } from "@/components/content/notes";
import { NotesView } from "@/components/content/notes-view";
import { PlayingNext } from "@/components/content/playing-next";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video-player";
import { VideoStatusBadge } from "@/components/video/status-badge";
import {
  useContent,
  useDeleteContent,
  useUpdateContent,
} from "@/modules/content/content.queries";
import { useCreateLoop, useUpdateLoop } from "@/modules/loop/loop.queries";
import { loopColor } from "@/lib/loop-color";
import { useOrganization } from "@/modules/organization/organization.queries";
import { useSubtitles } from "@/modules/subtitle/subtitle.queries";
import { useThumbnail } from "@/modules/thumbnail/thumbnail.queries";
import { useStream, useVideo } from "@/modules/video/video.queries";
import { useSection, useSections } from "@/modules/section/section.queries";
import type { TranscriptLine } from "@/lib/transcript";
import type { Content, ContentLoop, NotesDocument, Video } from "@/types";

/**
 * A lesson: its title, the video, and everything filed under it.
 *
 * The player is here rather than linked away to, because a lesson *is* the
 * video and the material around it — being sent to another page to watch it and
 * back again to read the notes is what made the two feel like separate things.
 *
 * Captions are deliberately not switched on for the player: the transcript tab
 * is the words, animated and seekable, and painting a second copy of the same
 * sentence over the picture would only be in the way.
 */

/**
 * Quiet tabs: an underline, not pills, on a page whose subject is the video.
 *
 * `shrink-0` because there are five of them in a column that is 30% of the page:
 * without it the flex row squeezes them into each other's padding rather than
 * admitting it has run out of room, and the labels collide before anything
 * scrolls.
 */
const QUIET_TAB =
  "shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-2 pt-0 text-[13px] font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

/**
 * The tab strip itself, which is allowed to run out of room.
 *
 * Five tabs do not fit a narrow panel, and squeezing them is worse than
 * scrolling them: the strip scrolls sideways instead, with its scrollbar hidden
 * because a horizontal scrollbar under an underline is uglier than the overflow
 * it reports. The border stays on the strip rather than on the tabs, so the rule
 * under them is the panel's width however far the tabs scroll.
 */
const TAB_STRIP =
  "h-auto w-full justify-start gap-4 overflow-x-auto rounded-none border-b border-border/60 bg-transparent p-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

/** What the lesson carries, on one quiet line above its name. */
function Meta({ content }: { content: Content }) {
  const stats = [
    { icon: PaperclipIcon, value: content.fileCount, label: "files" },
    { icon: HeartIcon, value: content.favouriteCount, label: "favourites" },
    { icon: MessageSquareIcon, value: content.commentCount, label: "comments" },
  ].filter((stat) => stat.value > 0);

  if (stats.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {stats.map(({ icon: Icon, value, label }) => (
        <span
          key={label}
          className="inline-flex items-center gap-1"
          title={`${value} ${label}`}
        >
          <Icon className="size-3" />
          <span className="tabular-nums">{value}</span>
        </span>
      ))}
    </p>
  );
}

/** A quiet line where a tab has nothing to show yet. */
function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="grid min-h-32 place-items-center px-6 text-center text-[13px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/** The video, playing where it is talked about. */
function LessonVideo({
  videoId,
  playerRef,
  autoPlay,
  children,
}: {
  videoId: string;
  playerRef: React.MutableRefObject<VideoPlayerHandle | null>;
  /** Started from the lesson before it, rather than opened. */
  autoPlay: boolean;
  /** The loop bar, which is part of the player while a loop is being chosen. */
  children?: React.ReactNode;
}) {
  const { data: videoRes } = useVideo(videoId);
  const video = videoRes?.video;
  const isReady = video?.status === "READY";

  const { data: stream } = useStream(videoId, isReady);
  const { data: thumbnail } = useThumbnail(
    videoId,
    Boolean(isReady && video?.thumbnailKey),
  );

  if (!isReady || !stream) {
    return (
      <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border bg-muted/40">
        {video ? (
          <div className="grid justify-items-center gap-2 text-center">
            <VideoStatusBadge status={video.status} />
            <p className="max-w-xs text-[13px] text-muted-foreground">
              {video.status === "FAILED"
                ? "This video failed to encode. Open it in the library to retry."
                : "The video is still being prepared."}
            </p>
          </div>
        ) : (
          <Skeleton className="size-full rounded-2xl" />
        )}
      </div>
    );
  }

  return (
    <div>
      <VideoPlayer
        ref={playerRef}
        src={stream.manifestUrl}
        signedQuery={stream.signedQuery}
        poster={thumbnail?.thumbnailUrl}
        autoPlay={autoPlay}
      />

      {children}
    </div>
  );
}

/** The video's words, animated word by word and seekable by tapping one. */
function TranscriptTab({
  videoId,
  lines,
  video,
  getTime,
  onSeek,
  selection,
  selectionColor,
  onSelectLine,
  canEdit,
}: {
  videoId?: string;
  lines: TranscriptLine[];
  video: Video | undefined;
  /** Playback position in milliseconds, read fresh every frame. */
  getTime: () => number;
  onSeek: (timeMs: number) => void;
  selection?: { startMs: number; endMs: number } | null;
  selectionColor?: string;
  onSelectLine?: (line: TranscriptLine) => void;
  canEdit: boolean;
}) {
  if (!videoId) {
    return (
      <EmptyNote>
        {canEdit
          ? 'A transcript appears here once this lesson has a video and its subtitles have been generated.'
          : 'This lesson has no video yet.'}
      </EmptyNote>
    );
  }

  if (video && video.subtitleStatus !== 'READY') {
    return (
      <EmptyNote>
        {video.subtitleStatus === 'GENERATING'
          ? 'The transcript is still being written.'
          : canEdit
            ? 'This video has no transcript yet. Generate subtitles from the video’s own page and the transcript will appear here.'
            : 'This lesson has no transcript yet.'}
      </EmptyNote>
    );
  }

  if (lines.length === 0) {
    return <Skeleton className="h-[420px] rounded-2xl lg:h-full" />;
  }

  return (
    <AnimatedTranscript
      lines={lines}
      getTime={getTime}
      onSeek={onSeek}
      selection={selection}
      selectionColor={selectionColor}
      onSelectLine={onSelectLine}
      className="h-[420px] lg:h-full"
    />
  );
}

/** The notes, rendered; and the editor that replaces them while they are edited. */
function NotesTab({
  content,
  spaceId,
  canEdit,
}: {
  content: Content;
  spaceId: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NotesDocument | undefined>(content.notes);
  const update = useUpdateContent(content.contentId, spaceId);

  const hasNotes = !isEmptyNotes(content.notes);

  async function save() {
    try {
      // An emptied editor clears the notes rather than storing an empty
      // document, so "no notes" has one representation.
      await update.mutateAsync({
        notes: draft && !isEmptyNotes(draft) ? draft : null,
      });
      toast.success("Notes saved");
      setEditing(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the notes",
      );
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
    <div className="grid gap-2">
      {hasNotes ? (
        <NotesView notes={content.notes} />
      ) : (
        <EmptyNote>
          {canEdit ? "No notes yet." : "No notes for this lesson."}
        </EmptyNote>
      )}

      {canEdit && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              setDraft(content.notes);
              setEditing(true);
            }}
          >
            <PencilIcon />
            {hasNotes ? "Edit notes" : "Write notes"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ContentPage() {
  const { orgId, spaceId, contentId } = useParams<{
    orgId: string;
    spaceId: string;
    contentId: string;
  }>();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [activeLoop, setActiveLoop] = useState<ContentLoop | null>(null);

  /**
   * The loop picker. `draft` is the selection it opened with, `editing` the loop
   * it is moving when it was opened on one that already exists.
   */
  const [draft, setDraft] = useState<LoopRange | null>(null);
  const [editingLoop, setEditingLoop] = useState<ContentLoop | null>(null);
  /** Whether the passage being chosen is being heard, once asked for. */
  const [previewing, setPreviewing] = useState(false);

  // The lesson before this one sends `?play=1`, which is how an automatic
  // advance carries on playing instead of landing on a paused page.
  const autoPlay = useSearchParams().get("play") === "1";

  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== "VIEWER" : false;

  const { data, isLoading, isError, error } = useContent(contentId);
  const content = data?.content;

  // The transcript drives itself off the player's own clock: it reads the
  // media element once a frame, which is smooth enough to fill a word letter by
  // letter, and seeks through the same handle.
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  const getTime = useCallback(() => playerRef.current?.getTimeMs() ?? 0, []);
  const getDuration = useCallback(
    () => playerRef.current?.getDurationMs() ?? 0,
    [],
  );
  const playVideo = useCallback(() => playerRef.current?.play(), []);

  const handleSeek = useCallback((timeMs: number) => {
    playerRef.current?.seekTo(timeMs);
  }, []);

  // The transcript is read by the transcript itself, by the loop picker while it
  // is choosing a passage, and by the loop list to show what each loop covers.
  const { lines, video } = useTranscriptLines(content?.videoId);

  // The course, in order, to know what comes next. The same query the sidebar
  // beside this page already asked for, so it costs nothing.
  const { data: outline } = useSections(spaceId);
  const next = useMemo(
    () => (outline ? findNextWatchable(outline.sections, contentId) : null),
    [outline, contentId],
  );

  const handleAdvance = useCallback(() => {
    if (!next) return;
    router.push(
      `/o/${orgId}/spaces/${spaceId}/contents/${next.contentId}?play=1`,
    );
  }, [next, orgId, router, spaceId]);

  // One loop at a time, whether it is a saved one being played or a draft being
  // previewed — a reader cannot be inside two loops at once, and pretending
  // otherwise would only make the playhead argue with itself. Opening the picker
  // does not start one on its own: the video plays straight through until the
  // reader asks to hear the passage.
  const playingLoop = previewing && draft ? draft : activeLoop;

  useLoopPlayback({
    loop: playingLoop,
    getTimeMs: getTime,
    seekTo: handleSeek,
    play: playVideo,
  });

  const openPicker = useCallback(
    (loop?: ContentLoop) => {
      // Moving a loop that already exists is the same picker with a different
      // ending: its own boundaries, and its own name.
      if (loop) {
        setEditingLoop(loop);
        setPreviewing(false);
        setDraft({ startMs: loop.startMs, endMs: loop.endMs });
        return;
      }

      const duration = getDuration();
      if (duration <= 0) {
        toast.error("Wait for the video to load before starting a loop");
        return;
      }

      // A new loop opens about a phrase long, and never past the end of the
      // video, so there is something to drag the moment the bar appears.
      const now = Math.round(getTime());
      const endMs = Math.min(now + DEFAULT_LOOP_SECONDS * 1000, duration);

      if (endMs - now < 500) {
        toast.error(
          "Start the video a little earlier — there is no room for a loop here",
        );
        return;
      }

      setEditingLoop(null);
      setPreviewing(false);
      // Widened to the sentences it falls in: a passage starts at the beginning
      // of one, and boundaries set from a playhead land mid-word as often as not.
      setDraft(snapRangeToLines(lines, now, endMs));
    },
    [getDuration, getTime, lines],
  );

  const closePicker = useCallback(() => {
    setDraft(null);
    setEditingLoop(null);
    setPreviewing(false);
  }, []);

  /** Hears the passage, or stops hearing it, to check what either side holds. */
  const togglePreview = useCallback(() => {
    if (previewing) {
      setPreviewing(false);
      return;
    }

    if (draft) {
      handleSeek(draft.startMs);
      playVideo();
    }
    setPreviewing(true);
  }, [draft, handleSeek, playVideo, previewing]);

  /**
   * Taps a line to grow the passage around it — mandarino's gesture, and the
   * fastest way to mark "from here to there" while reading along: a line before
   * the passage moves its start, a line after it moves its end, and a line
   * inside it does nothing but play. Whole lines either way, so the passage is
   * never half a sentence.
   */
  const selectLine = useCallback(
    (line: TranscriptLine) => {
      setDraft((current) => {
        if (!current) return current;

        if (line.start < current.startMs) {
          return { startMs: line.start, endMs: current.endMs };
        }
        if (line.end > current.endMs) {
          return { startMs: current.startMs, endMs: line.end };
        }
        return current;
      });

      // Wherever the tap landed, you hear it — choosing is still listening.
      handleSeek(line.start);
    },
    [handleSeek],
  );

  const createLoop = useCreateLoop(contentId);
  const updateLoop = useUpdateLoop(contentId);

  /**
   * Keeping what the picker has chosen — under a new name, or under the name the
   * loop it was opened on already had.
   */
  const saveLoop = useCallback(
    (range: LoopRange, name: string) => {
      const onError = (err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Could not save the loop",
        );

      // Either way it starts looping: what was just kept is a loop, and having
      // to press play on the thing you named a second ago is a silly question.
      const onSuccess = ({ loop }: { loop: ContentLoop }) => {
        closePicker();
        setActiveLoop(loop);
        toast.success(editingLoop ? "Loop updated" : "Loop saved");
      };

      if (editingLoop) {
        updateLoop.mutate(
          {
            loopId: editingLoop.loopId,
            name,
            startMs: range.startMs,
            endMs: range.endMs,
          },
          { onSuccess, onError },
        );
        return;
      }

      createLoop.mutate(
        { name, startMs: range.startMs, endMs: range.endMs },
        { onSuccess, onError },
      );
    },
    [closePicker, createLoop, editingLoop, updateLoop],
  );

  const upNext = usePlayingNext({
    getTimeMs: getTime,
    getDurationMs: getDuration,
    enabled: Boolean(next?.videoId),
    onAdvance: handleAdvance,
  });

  // The section is only needed for the way back, so a missing one is not an
  // error — the link just says where it goes instead of naming it.
  const { data: sectionData } = useSection(content?.sectionId ?? "");

  const remove = useDeleteContent(spaceId);

  async function deleteContent() {
    if (!content) return;
    const confirmed = window.confirm(
      `Delete “${content.title}”? Its notes, files and comments go with it.`,
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(content.contentId);
      toast.success("Content deleted");
      router.push(`/o/${orgId}/spaces/${spaceId}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete the content",
      );
    }
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load this content"}
      </p>
    );
  }

  if (isLoading || !content) {
    return (
      <div className="grid gap-6 pb-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  const section = sectionData?.section;

  return (
    // Two rows on a desktop screen: the way back, and then a split that fills
    // whatever is left. `minmax(0, 1fr)` rather than `1fr` so the split can be
    // shorter than its contents — which is what lets the panel scroll inside
    // itself instead of the page scrolling as a whole.
    <div className="grid gap-x-5 gap-y-4 lg:h-full lg:grid-rows-[auto_auto_minmax(0,1fr)] lg:gap-y-5">
      <Link
        href={`/o/${orgId}/spaces/${spaceId}`}
        className="inline-flex w-fit items-center gap-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        {section ? section.title : "Spaces"}
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Meta content={content} />
          <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {content.title}
          </h1>
        </div>

        {canEdit && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-2 size-8 shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
                  aria-label="Lesson actions"
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {/* The menu closes before this opens: a dialog inside a menu
                    item fights the menu for focus. */}
                <DropdownMenuItem
                  onSelect={() => setTimeout(() => setEditing(true), 0)}
                >
                  <PencilIcon />
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={deleteContent}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ContentDetailsDialog
              orgId={orgId}
              spaceId={spaceId}
              content={content}
              open={editing}
              onOpenChange={setEditing}
            />
          </>
        )}
      </header>

      {/* Half the width each: the video on the left, everything filed under it on
          the right. Below `lg` the two stack and the page scrolls normally,
          because a phone has no second half to give.

          The title sits above both rather than inside the left half, which is
          what lets the video and the panel start on the same line — a heading in
          the video's own column would push it down by its own height and leave
          the two columns visibly out of step. */}
      {/* Seven to three: the video is what the lesson is, and the panel beside
          it is read at a glance. The panel keeps a floor, because a third of a
          narrow window is not enough to read a sentence in. */}
      {/* Fixed to the corner of the page, not of the video: see the card. */}
      {next && upNext.seconds !== null && (
        <PlayingNext
          title={next.title}
          seconds={upNext.seconds}
          total={upNext.total}
          onPlayNow={upNext.playNow}
          onCancel={upNext.cancel}
        />
      )}

      <div className="grid min-h-0 gap-6 lg:mt-2 lg:grid-cols-[minmax(0,7fr)_minmax(18rem,3fr)]">
        <div>
          {content.videoId ? (
            <LessonVideo
              videoId={content.videoId}
              playerRef={playerRef}
              autoPlay={autoPlay}
            >
              <div className="mt-4">
                {draft && (
                  <LoopBar
                    durationMs={getDuration()}
                    getTimeMs={getTime}
                    seekTo={handleSeek}
                    initialRange={draft}
                    accentColor={
                      editingLoop ? loopColor(editingLoop) : "#6366f1"
                    }
                    lines={lines}
                    selectedLines={linesInRange(lines, draft.startMs, draft.endMs).length}
                    selectedText={transcriptTextFor(lines, draft.startMs, draft.endMs)}
                    editingName={editingLoop?.name}
                    previewing={previewing}
                    onTogglePreview={togglePreview}
                    onSave={saveLoop}
                    onCancel={closePicker}
                  />
                )}
              </div>
            </LessonVideo>
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-muted/20 text-center">
              <VideoOffIcon className="size-5 text-muted-foreground/60" />
              <p className="text-[13px] text-muted-foreground">
                {canEdit
                  ? "This lesson has nothing to play yet."
                  : "This lesson has no video yet."}
              </p>
              {canEdit && (
                <ContentDetailsDialog
                  orgId={orgId}
                  spaceId={spaceId}
                  content={content}
                  trigger={
                    <Button variant="outline" size="sm">
                      Choose a video
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </div>

        <Tabs
          defaultValue="transcript"
          className="flex min-h-0 flex-col lg:rounded-2xl lg:border lg:bg-card lg:p-5"
        >
          <TabsList className={TAB_STRIP}>
            <TabsTrigger value="transcript" className={QUIET_TAB}>
              Transcript
            </TabsTrigger>
            <TabsTrigger value="notes" className={QUIET_TAB}>
              Notes
            </TabsTrigger>
            <TabsTrigger value="files" className={QUIET_TAB}>
              Files
              {content.fileCount > 0 && (
                <span className="ml-1.5 tabular-nums text-muted-foreground/70">
                  {content.fileCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="loops" className={QUIET_TAB}>
              Loops
            </TabsTrigger>
            <TabsTrigger value="comments" className={QUIET_TAB}>
              Comments
            </TabsTrigger>
          </TabsList>

          {/* The transcript owns its own scroll — the sheet follows the playhead
              itself — so the panel must not scroll it a second time. Everything
              else is read top to bottom and scrolls here. */}
          <TabsContent
            value="transcript"
            className="mt-4 min-h-0 flex-1 overflow-hidden"
          >
            <TranscriptTab
              videoId={content.videoId}
              lines={lines}
              video={video}
              getTime={getTime}
              onSeek={handleSeek}
              selection={draft}
              selectionColor={editingLoop ? loopColor(editingLoop) : '#6366f1'}
              onSelectLine={draft ? selectLine : undefined}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent
            value="notes"
            className="mt-4 min-h-0 flex-1 overflow-y-auto"
          >
            <NotesTab content={content} spaceId={spaceId} canEdit={canEdit} />
          </TabsContent>

          <TabsContent
            value="files"
            className="mt-4 min-h-0 flex-1 overflow-y-auto"
          >
            <ContentFiles contentId={content.contentId} canEdit={canEdit} />
          </TabsContent>

          <TabsContent
            value="loops"
            className="mt-4 min-h-0 flex-1 overflow-y-auto"
          >
            <ContentLoops
              contentId={content.contentId}
              lines={lines}
              activeLoopId={activeLoop?.loopId ?? null}
              onActivate={(loop) => {
                setPreviewing(false);
                setActiveLoop(loop);
              }}
              onDeactivate={() => setActiveLoop(null)}
              onStartSelection={() => openPicker()}
              onMoveRange={(loop) => openPicker(loop)}
              onSeek={(timeMs) => {
                // Straight to the words, and playing: a tap on a passage is a
                // request to hear it, not to put the playhead somewhere and
                // leave it there.
                handleSeek(timeMs);
                playVideo();
              }}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent
            value="comments"
            className="mt-4 min-h-0 flex-1 overflow-y-auto"
          >
            <EmptyNote>
              The discussion opens here with the classroom — comments, replies
              and favourites are already built behind it.
            </EmptyNote>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
