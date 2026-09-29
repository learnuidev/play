"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CaptionsIcon,
  CheckIcon,
  ChevronLeftIcon,
  ListTreeIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  PaperclipIcon,
  PencilIcon,
  RepeatIcon,
  SparklesIcon,
  Trash2Icon,
  VideoOffIcon,
} from "lucide-react";
import { toast } from "sonner";
import { findNextWatchable } from "@learning/lib/course";
import {
  linesInRange,
  snapRangeToLines,
  transcriptTextFor,
} from "@learning/lib/transcript";
import { useLoopPlayback } from "@learning/hooks/use-loop-playback";
import { useLessonTab } from "@learning/hooks/use-lesson-tab";
import { useRememberedScroll } from "@learning/hooks/use-remembered-scroll";
import { useViewerId } from "@auth/hooks/use-viewer";
import { usePlayingNext } from "@learning/hooks/use-playing-next";
import { useTranscriptLines } from "@learning/hooks/use-transcript-lines";
import { Button } from "@ui/components/ui/button";
import { Skeleton } from "@ui/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ui/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ui/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ui/components/ui/dropdown-menu";
import { AnimatedTranscript } from "@learning/components/content/animated-transcript";
import { ContentComments } from "@learning/components/content/content-comments";
import { ContentDetailsDialog } from "@learning/components/content/content-details-dialog";
import { ContentFavourite } from "@learning/components/content/content-favourite";
import { ContentFiles } from "@learning/components/content/content-files";
import { ContentLoops } from "@learning/components/content/content-loops";
import { CourseContents } from "@learning/components/content/course-contents";
import {
  DEFAULT_LOOP_SECONDS,
  LoopBar,
  type LoopRange,
} from "@learning/components/content/loop-bar";
import { NotesEditor } from "@learning/components/content/notes-editor";
import { isEmptyNotes } from "@learning/components/content/notes";
import { NotesView } from "@learning/components/content/notes-view";
import { PlayingNext } from "@learning/components/content/playing-next";
import { QuizPanel } from "@learning/components/quiz/quiz-panel";
import {
  VideoPlayer,
  type SubtitleTrack,
  type VideoPlayerHandle,
} from "@learning/components/video-player";
import { VideoStatusBadge } from "@learning/components/video/status-badge";
import {
  useContent,
  useCreateContent,
  useDeleteContent,
  usePlaceContent,
  useUpdateContent,
} from "@api/modules/content/content.queries";
import { useGenerateQuestions } from "@api/modules/question/question.queries";
import { useToggleCompletion } from "@api/modules/content/completion.queries";
import {
  useCreateLoop,
  useLoops,
  useUpdateLoop,
} from "@api/modules/loop/loop.queries";
import { loopColor } from "@learning/lib/loop-color";
import {
  LearningRoutesProvider,
  useLearningRoutes,
  type LearningRoutes,
} from "@learning/lib/learning-routes";
import { useSubtitles } from "@api/modules/subtitle/subtitle.queries";
import { useThumbnail } from "@api/modules/thumbnail/thumbnail.queries";
import { useStream, useVideo } from "@api/modules/video/video.queries";
import { useSection, useSections } from "@api/modules/section/section.queries";
import type { TranscriptLine } from "@learning/lib/transcript";
import type { Content, ContentLoop, NotesDocument, Video } from "@play/types";

/**
 * How long a title this app may send.
 *
 * The API's own ceiling, repeated here for the one place a title is *built*
 * rather than typed: a quiz made from a lesson is named after it, and a lesson
 * already at the limit must produce a quiz rather than a refusal.
 */
const MAX_CONTENT_TITLE_LENGTH = 120;
const QUIZ_TITLE_PREFIX = "Quiz: ";

/** How many questions the lesson shortcut asks for. See the dialog's own default. */
const QUESTIONS_PER_GENERATION = 10;

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
 * The icons are sized here rather than at each call site so the five of them
 * cannot drift apart, and at 20px rather than Lucide's 24px default, which reads
 * as a row of buttons in a panel this narrow.
 *
 * The padding is what the underline is drawn across, so it is also the target.
 * `shrink-0` so a narrow panel cannot squeeze them into each other's padding
 * instead of admitting it has run out of room.
 */
const QUIET_TAB =
  "shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-3 pb-2 pt-1 text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none [&_svg]:size-5";

/**
 * The tab strip: five icons, spread evenly across the panel.
 *
 * `justify-evenly` rather than a fixed gap, because the panel is a different
 * width on every screen: a row of icons bunched at one end with a gap between
 * them looks like an accident, while one spread across the whole width reads as
 * the panel's own bar whatever that width is. The gap is only a floor, for a
 * panel so narrow that even spreading would crowd them.
 *
 * The sideways scrolling is kept as a last resort, with its scrollbar hidden —
 * a horizontal one under an underline is uglier than the overflow it reports —
 * and the border stays on the strip rather than on the tabs, so the rule under
 * them is the panel's width however far the tabs run.
 */
const TAB_STRIP =
  "h-auto w-full justify-evenly gap-1 overflow-x-auto rounded-none border-b border-border/60 bg-transparent p-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

/**
 * A column that scrolls without saying so.
 *
 * A lesson is watched: its columns scroll the whole time they are open — the
 * transcript sheet follows the playhead — and a native bar parked beside the
 * video is chrome on the one page that is a picture with a little around it.
 * It is worse than decoration, because it also takes its width from the video
 * the moment it appears and gives it back when it goes, so the picture changes
 * size on its own. `scrollbar-width` and `-ms-overflow-style` are the two
 * engines that are not WebKit, and the arbitrary variant is the rest.
 *
 * The transcript sheet has always been treated this way (`.tt-scroll` in
 * `globals.css`), so a bar beside it would be the odd one out.
 */
const NO_SCROLLBAR =
  "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

/**
 * What the lesson carries, on the breadcrumb line beside its name.
 *
 * Beside rather than above, which is where it sat when the name was the page's
 * one large heading: a heading has room to be annotated, a 13px line does not,
 * and the counts are small enough to be the tail of it.
 *
 * The comments are not counted here any more, and no longer on the tab strip
 * either: the discussion sits under the video and says how many it has where it
 * is written, and a copy up here only made the line longer than the thing it was
 * annotating.
 *
 * The favourites went the same way, one step further: the count sits in the
 * heart that moves it (`ContentFavourite`) rather than on this line beside the
 * button that moves it, because a number in one place and the control for it in
 * another reads as two facts about the lesson instead of one.
 */
function Meta({ content }: { content: Content }) {
  const stats = [
    { icon: PaperclipIcon, value: content.fileCount, label: "files" },
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

/**
 * One tab: an icon, and what it holds when you point at it.
 *
 * The labels went because five of them over a video read as a row of words
 * competing with the picture. The name has not gone anywhere — it is the
 * accessible name, and the tooltip — and the tooltip says what is *inside*
 * rather than only repeating the name, which is the question an icon-only strip
 * actually raises. The course is the widest of what is left to name, so it asks
 * for the tooltip most.
 *
 * Nothing here is counted any more. The one tab that carried a number was the
 * discussion, and it went under the video with the discussion: the count is
 * where the comments are, rather than on the icon you have to press to see
 * whether it is worth pressing.
 */
function LessonTab({
  value,
  icon,
  label,
  hint,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TabsTrigger value={value} className={QUIET_TAB} aria-label={label}>
          {icon}
        </TabsTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56 text-center">
        <span className="font-medium">{label}</span>
        <span className="mt-0.5 block opacity-80">{hint}</span>
      </TooltipContent>
    </Tooltip>
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
  tracks,
  onActiveTrackChange,
  children,
}: {
  videoId: string;
  playerRef: React.MutableRefObject<VideoPlayerHandle | null>;
  /** Play as soon as the stream can, rather than waiting to be pressed. */
  autoPlay: boolean;
  /** The lesson's subtitles, as the captions drawn over the video. */
  tracks: SubtitleTrack[];
  /** The language the captions ended up in, so the transcript can follow it. */
  onActiveTrackChange: (language: string | null) => void;
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
        tracks={tracks}
        onActiveTrackChange={onActiveTrackChange}
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
  /**
   * Tapping a line: hear it from there.
   *
   * Not a bare seek — the reader who taps a line wants the video to play it, and
   * on a lesson that has only just been opened there is nothing playing yet for
   * a seek to move. The tab is the first thing reached for after the video, so
   * it is also the way playback starts.
   */
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
          ? "A transcript appears here once this lesson has a video and its subtitles have been generated."
          : "This lesson has no video yet."}
      </EmptyNote>
    );
  }

  if (video && video.subtitleStatus !== "READY") {
    return (
      <EmptyNote>
        {video.subtitleStatus === "GENERATING"
          ? "The transcript is still being written."
          : canEdit
            ? "This video has no transcript yet. Generate subtitles from the video’s own page and the transcript will appear here."
            : "This lesson has no transcript yet."}
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

/**
 * A lesson being taken: the video, the transcript, the notes, the files, the
 * loops and the discussion — laid out as one page.
 *
 * Everything the lesson points at comes from the caller: which course and
 * lesson these are, whether the reader may change them, and where a course and
 * a lesson live in this app's URLs. The studio passes an author's answers and
 * the marketplace a learner's, and the lesson itself is identical either way.
 */
export function Classroom({
  spaceId,
  contentId,
  orgId,
  canEdit = false,
  routes,
}: {
  spaceId: string;
  contentId: string;
  /**
   * The organization a course belongs to, for the authoring dialogs only —
   * picking a video out of a library is an organization's library. Absent in an
   * app where nobody edits anything.
   */
  orgId?: string;
  /** Whether this reader may edit the lesson: notes, files, details, deletion. */
  canEdit?: boolean;
  routes: LearningRoutes;
}) {
  return (
    <LearningRoutesProvider routes={routes}>
      <ClassroomBody
        spaceId={spaceId}
        contentId={contentId}
        orgId={orgId}
        canEdit={canEdit}
      />
    </LearningRoutesProvider>
  );
}

/** The lesson itself, with the app's own URLs read from the provider above it. */
function ClassroomBody({
  spaceId,
  contentId,
  orgId,
  canEdit,
}: {
  spaceId: string;
  contentId: string;
  orgId?: string;
  canEdit: boolean;
}) {
  const routes = useLearningRoutes();
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

  const search = useSearchParams();
  /** A shared loop: somebody sent a link that opens on their passage. */
  const sharedLoopId = search.get("loop");

  const viewerId = useViewerId();

  /** The language the video's captions are in, once a reader has chosen one. */
  const [captionsLanguage, setCaptionsLanguage] = useState<string | null>(null);

  /**
   * The transcript follows the captions.
   *
   * The two are the same words: a reader who switches the captions to French is
   * reading in French, and leaving the page beside the video in English would
   * make them two documents instead of one. Turning the captions *off* is not a
   * language and does not move it back — that would take the transcript out from
   * under someone who is still reading it.
   */
  const followCaptionsLanguage = useCallback((language: string | null) => {
    if (language) setCaptionsLanguage(language);
  }, []);

  /**
   * Which tab the panel is on, and where the course list is scrolled to — both
   * remembered across lessons, because picking the next lesson out of the Course
   * tab used to throw the reader back to the transcript at the top of the list.
   */
  const [panelTab, choosePanelTab] = useLessonTab();
  const courseListRef = useRememberedScroll<HTMLDivElement>("course");

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

  /** A tap on a moment, parked until there is a player to give it to. */
  const [pendingPlay, setPendingPlay] = useState<number | null>(null);

  /**
   * Plays from a moment somebody named: a loop's own boundaries, a time an `@`
   * was put in front of in a comment, or a line tapped in the transcript.
   *
   * Seeking is not playing: a player that has been paused and put somewhere
   * else is still paused. Naming a passage is a request to *hear* it — a tap on
   * a loop, a time in a comment and a line of the transcript are all that — so
   * this asks for both, in that order, and leaves nothing for the caller to
   * remember. On a lesson that has just been opened this is also what starts the
   * video at all: the tap is the first thing the reader does, and a seek on a
   * stream that has not loaded yet goes nowhere on its own.
   */
  const playFrom = useCallback(
    (timeMs: number) => {
      // The video mounts a beat after the lesson does — its stream has to
      // arrive first — and a tap inside that beat has nothing to seek and
      // nothing to play. It is held rather than dropped; the effect below
      // honours it the moment the player is on the page.
      if (!playerRef.current) {
        setPendingPlay(timeMs);
        return;
      }

      handleSeek(timeMs);
      playVideo();
    },
    [handleSeek, playVideo],
  );

  /**
   * A tap that landed before the player existed.
   *
   * Waited for by the frame, because the wait is short and the point is to lose
   * as little of it as possible: `play()` is only something the browser has to
   * allow because a person asked for it, and that asking has a shelf life. So
   * the wait is bounded to the window in which it still counts as the reader's
   * own gesture — past it the position is not worth keeping, since a seek with
   * no sound is not what they asked for.
   */
  useEffect(() => {
    if (pendingPlay === null) return;

    const GESTURE_GRACE_MS = 5000;
    const deadline = performance.now() + GESTURE_GRACE_MS;
    let frame = 0;

    const tick = () => {
      if (playerRef.current) {
        handleSeek(pendingPlay);
        playVideo();
        setPendingPlay(null);
        return;
      }

      if (performance.now() >= deadline) {
        setPendingPlay(null);
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pendingPlay, handleSeek, playVideo]);

  // The transcript is read by the transcript itself, by the loop picker while it
  // is choosing a passage, and by the loop list to show what each loop covers.
  // The captions over the video are read from here too — they are the same
  // subtitles, in the language the reader put them in.
  const { lines, video, tracks } = useTranscriptLines(
    content?.videoId,
    captionsLanguage,
  );

  // The course, in order, to know what comes next. The same query the Course
  // tab asks for, so it costs nothing extra.
  const { data: outline } = useSections(spaceId);
  const next = useMemo(
    () => (outline ? findNextWatchable(outline.sections, contentId) : null),
    [outline, contentId],
  );

  /**
   * A link that opens this lesson on this passage.
   *
   * The range travels in the link rather than in anything the server has to
   * remember: whoever opens it gets the loop selected and playing, which is the
   * whole of what sharing one means. `origin` is read at the moment of copying
   * rather than at render, since there is no such thing during a server render.
   */
  const shareLoop = useCallback(
    async (loop: ContentLoop) => {
      const url = `${window.location.origin}${routes.lesson(spaceId, contentId)}?loop=${loop.loopId}`;

      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied", {
          description: `Opens on “${loop.name}”`,
        });
      } catch {
        // A clipboard can be refused, and a link nobody can copy is worse than
        // one they have to select by hand.
        window.prompt("Copy this link", url);
      }
    },
    [contentId, routes, spaceId],
  );

  /** The lesson after this one, opened the way any lesson is: playing. */
  const handleAdvance = useCallback(() => {
    if (!next) return;
    router.push(routes.lesson(spaceId, next.contentId));
  }, [next, routes, router, spaceId]);

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

  /**
   * A shared link opens on the passage it names.
   *
   * The same query the Loops tab asks for, so this costs nothing extra, and it
   * waits for the loops to arrive before deciding: the link may be opened before
   * anything is loaded, and a loop that arrives a moment later still lands.
   */
  const { data: loopData } = useLoops(contentId, Boolean(sharedLoopId));
  const openedSharedRef = useRef(false);

  useEffect(() => {
    if (!sharedLoopId || openedSharedRef.current) return;

    const loop = loopData?.loops.find(
      (candidate) => candidate.loopId === sharedLoopId,
    );
    if (!loop) return;

    openedSharedRef.current = true;
    setActiveLoop(loop);
    // Through `playFrom` rather than a seek and a play of its own: a link opened
    // cold arrives before the player does, and that is exactly the case it
    // parks and honours.
    playFrom(loop.startMs);
  }, [loopData, playFrom, sharedLoopId]);

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
  const completion = useToggleCompletion(contentId, spaceId);

  /**
   * Making a quiz out of the lesson being read.
   *
   * The shortcut the whole feature is for: an author watches a lesson, decides
   * it should be checked, and does not want to go and create a quiz, find the
   * lesson in a list, and pick it there. Three calls, in an order that matters:
   * the quiz is created, moved to sit directly under the lesson it came from,
   * and only then is the run asked for — a run that started first would be
   * writing into a quiz that is still at the end of the section, which is where
   * the reader would then be looking for it.
   */
  const createQuiz = useCreateContent(content?.sectionId ?? "", spaceId);
  const placeQuiz = usePlaceContent(spaceId);
  const startGeneration = useGenerateQuestions(spaceId);

  async function generateQuiz() {
    if (!content) return;

    try {
      const { content: quiz } = await createQuiz.mutateAsync({
        // The API's ceiling for a title is 120 characters, and the prefix is
        // part of the title: a lesson named to the limit gets a quiz named as
        // much of itself as fits, rather than a refusal.
        title: `Quiz: ${content.title.slice(0, MAX_CONTENT_TITLE_LENGTH - QUIZ_TITLE_PREFIX.length)}`,
        type: "QUIZ",
      });

      // Straight after the lesson it was written from, which is where a reader
      // expects the check on what they have just watched.
      const section = outline?.sections.find((entry) => entry.sectionId === content.sectionId);
      const index = (section?.contents.findIndex((entry) => entry.contentId === content.contentId) ?? -1) + 1;

      if (index > 0) {
        await placeQuiz.mutateAsync({ contentId: quiz.contentId, sectionId: content.sectionId, index });
      }

      await startGeneration.mutateAsync({
        contentId: quiz.contentId,
        sourceContentId: content.contentId,
        count: QUESTIONS_PER_GENERATION,
      });

      toast.success("Quiz created", {
        description: "Questions are being written from this lesson.",
      });
      router.push(routes.lesson(spaceId, quiz.contentId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the quiz");
    }
  }

  async function deleteContent() {
    if (!content) return;
    const confirmed = window.confirm(
      `Delete “${content.title}”? Its notes, files and comments go with it.`,
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(content.contentId);
      toast.success("Content deleted");
      router.push(routes.course(spaceId));
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
  const completed = data?.viewer.completed ?? false;

  /**
   * A quiz is not a lesson with a different picture.
   *
   * It is a list of questions to write and review, and none of what this page is
   * built around — the player, the transcript, the loops, the moment-by-moment
   * discussion — has anything to do with it. So it is rendered here rather than
   * inside the lesson's layout: the quiz panel is shared with the studio's
   * authoring page, and `canEdit` is the whole of the difference between what an
   * author and a learner see.
   *
   * This branch sits below every hook in this component on purpose: a return
   * above them would change the number of hooks between renders the moment
   * somebody switched a content's kind.
   */
  if (content.type === "QUIZ") {
    return (
      <div className="grid gap-6 pb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={routes.course(spaceId)}
            title={section ? `Back to ${section.title}` : "Back to your courses"}
            className="inline-flex min-w-0 items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeftIcon className="size-4 shrink-0" />
            <h1 className="truncate">{content.title}</h1>
          </Link>
        </div>

        <QuizPanel
          contentId={content.contentId}
          spaceId={spaceId}
          canEdit={canEdit}
          title={content.title}
        />
      </div>
    );
  }

  return (
    // Two rows on a desktop screen: the breadcrumb — which lesson this is, what
    // it carries, and the way out of it — and a split that fills whatever is
    // left. `minmax(0, 1fr)` rather than `1fr` so the split can be shorter than
    // its contents, which is what lets the columns scroll inside themselves
    // instead of the page scrolling as a whole.
    <div className="grid gap-x-4 gap-y-4 lg:h-full lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-y-4">
      {/* A breadcrumb, not a heading: one quiet line saying which lesson this
          is, in the same voice as the way back on a course's own page. The way
          back *is* that line — the lesson's name is the one thing up here worth
          clicking to leave the lesson, and where it goes is said by `title`
          rather than by a section's name sitting beside it, which is what this
          line used to carry.

          What it replaced was a 24px title under the picture, and that is the
          part worth keeping gone: a heading that size made the lesson the
          subject of its own page, when the video is. Below `md` the row wraps —
          the breadcrumb, then what the lesson carries and its actions, then the
          heart and the pill together — because a name squeezed between controls
          is not a name at 700 pixels either. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link
          href={routes.course(spaceId)}
          title={`Back to ${section ? section.title : "your courses"}`}
          className="inline-flex min-w-0 items-center gap-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4 shrink-0" />
          {/* The name is the link's own text, so what a screen reader reads is
              what is on the screen — and it truncates, because a lesson called
              half a sentence must not push the pill off the page. */}
          <h1 className="truncate">{content.title}</h1>
        </Link>

        <div className="flex w-full min-w-0 items-center gap-3 md:w-auto md:flex-1">
          <Meta content={content} />

          {canEdit && orgId && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    // Filed to the right beside the pill on a wide screen, and
                    // left next to the counts on a narrow one, where it shares
                    // the line with them rather than with a button a row below.
                    className="size-8 shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground md:ml-auto"
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
                  {/* A lesson is where an author notices it should be checked, so
                      this is where making a quiz out of it belongs — and it is
                      offered on a lesson only: a quiz has nothing to write
                      questions from. */}
                  {content.type === "VIDEO" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={startGeneration.isPending || createQuiz.isPending}
                        onSelect={() => void generateQuiz()}
                      >
                        <SparklesIcon />
                        Generate a quiz
                      </DropdownMenuItem>
                    </>
                  )}
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
        </div>

        {/* The opposite corner to the way back, and the opposite things: one
            saves the lesson for later, the other finishes it. `ml-auto` is on
            the pair rather than on either button, so they travel together —
            the heart pushed to the corner by a pill it does not belong to
            would read as a control of the pill's rather than of the lesson's. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* A favourite belongs to somebody, so a reader with no account is
              offered no heart: there is no list of theirs to put it in. */}
          {viewerId && (
            <ContentFavourite
              contentId={content.contentId}
              favourited={data?.viewer.favourited ?? false}
              count={content.favouriteCount}
            />
          )}

          <Button
            variant={completed ? "outline" : "default"}
            size="lg"
            // A pill, and the only one on the page: it is the lesson's one
            // decision — you are done here — and a shape of its own is what says
            // so without a second colour saying it.
            className={
              completed
                ? "shrink-0 gap-1.5 rounded-full border-emerald-600/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:border-emerald-400/40 dark:text-emerald-300 dark:hover:text-emerald-200"
                : "shrink-0 gap-1.5 rounded-full"
            }
            onClick={() =>
              completion.mutate(completed, {
                onSuccess: ({ completed: nowComplete, earned }) => {
                  if (nowComplete) toast.success("Lesson marked as complete");

                  // What the milestone check issued, said out loud: a reward
                  // nobody is told about is not a reward, and the tab it lives on
                  // is not where somebody finishing a lesson is looking.
                  if (earned && earned.length > 0) {
                    toast.success(
                      earned.length === 1
                        ? "You earned a reward"
                        : `You earned ${earned.length} rewards`,
                      {
                        description: earned
                          .map((grant) => grant.code ?? "A reward to claim")
                          .join(" · "),
                      },
                    );
                  }
                },
                onError: (err) =>
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : "Could not save your progress",
                  ),
              })
            }
            disabled={completion.isPending}
          >
            {completion.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : null}
            {completed ? "Completed" : "Complete lesson"}
          </Button>
        </div>
      </div>

      {/* The video on the left, everything filed under it on the right — except
          the discussion, which is filed under the video itself, because it is
          about the picture rather than a place to read beside it. The video is
          what the lesson is, so it takes the larger share — but only just,
          because the panel is where a lot of the reading happens: the transcript
          follows the playhead, the notes are read, and the course it belongs to
          now lives in there too. Below `lg` the two stack and the page scrolls
          normally, because a phone has no second half to give.

          Both columns start on the same line, under the header: the video at the
          top of its own column, and the panel's tab strip at the top of its. */}
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

      {/* Six to four, as a ratio rather than a floor: the two tracks grow with
          the window, so the panel is a comfortable column of prose on a wide
          screen and still one on a laptop. The video keeps its own aspect
          ratio, so the smaller share costs it height rather than shape.

          Both columns scroll themselves on a desktop screen, and they have to
          now that the discussion is under the picture: a lesson's comments are
          as long as the class is talkative, and the page around them is exactly
          one screen tall. The video column takes the scroll so a long discussion
          goes on below the fold of the column rather than pushing the whole
          lesson — panel included — past the bottom of the window. Below `lg`
          neither column is a screenful, so both grow and the page scrolls. */}
      <div className="grid min-h-0 gap-6 lg:mt-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className={`min-h-0 lg:overflow-y-auto ${NO_SCROLLBAR}`}>
          {content.videoId ? (
            // Opened, and playing: a lesson is a thing you came to watch, and
            // having to press play on the thing you just asked for is a step
            // that only ever stood between the reader and the lesson. The
            // browser gets to refuse an unmuted page starting itself, and the
            // player answers that by starting muted rather than not at all.
            <LessonVideo
              videoId={content.videoId}
              playerRef={playerRef}
              autoPlay
              tracks={tracks}
              onActiveTrackChange={followCaptionsLanguage}
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
                    selectedLines={
                      linesInRange(lines, draft.startMs, draft.endMs).length
                    }
                    selectedText={transcriptTextFor(
                      lines,
                      draft.startMs,
                      draft.endMs,
                    )}
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
              {/* Editing a lesson means picking from an organization's video
                  library, so an app that has no organization to hand shows no
                  editing controls at all. */}
              {canEdit && orgId && (
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

          {/* Under the video, where the picture is: a discussion is about what
              is playing, so it reads where the playing is. It was the last of
              the panel's tabs before this — in a column beside the picture on a
              wide screen, and behind a press below it on a phone, which is a
              strange place for the one thing on the page that is written by
              everybody else.

              It is a section rather than another card: the composer draws its
              own box, the threads are separated by hairlines, and a frame around
              all of it would be a box drawn around a box.

              The heading is a size up from the usual section heading because the
              discussion is set in `text-lg`: a heading under the text it
              introduces is a caption, whatever it is called.

              A time in a comment is a place in *this* lesson's own video, so a
              lesson without one leaves those times the words they were: there is
              no playhead to move, and a control that seeks nowhere is worse than
              plain text. */}
          <section className="mt-6 grid gap-3">
            <ContentComments
              contentId={content.contentId}
              viewerId={viewerId}
              canModerate={canEdit}
              onSeek={content.videoId ? playFrom : undefined}
            />
          </section>
        </div>

        {/* Controlled rather than defaulted: the tab is a place the reader is
            in, and it has to outlive the lesson they are in it on. */}
        <Tabs
          value={panelTab}
          onValueChange={choosePanelTab}
          className="flex min-h-0 flex-col lg:rounded-2xl lg:border lg:bg-card lg:p-5"
        >
          <TabsList className={TAB_STRIP}>
            <LessonTab
              value="course"
              icon={<ListTreeIcon />}
              label="Course"
              hint="Every lesson in this course, in order — the one you are reading is marked."
            />
            <LessonTab
              value="transcript"
              icon={<CaptionsIcon />}
              label="Transcript"
              hint="The video’s words, word by word — and where a loop is picked from."
            />
            <LessonTab
              value="notes"
              icon={<NotebookPenIcon />}
              label="Notes"
              hint="What the author wrote for this lesson."
            />
            <LessonTab
              value="files"
              icon={<PaperclipIcon />}
              label="Files"
              hint={
                content.fileCount > 0
                  ? `${content.fileCount} attachment${content.fileCount === 1 ? "" : "s"} for this lesson.`
                  : "Nothing attached to this lesson yet."
              }
            />
            <LessonTab
              value="loops"
              icon={<RepeatIcon />}
              label="Loops"
              hint="Passages worth hearing again, kept under a name."
            />
          </TabsList>

          {/* The course leads the strip, and the transcript stays what the panel
              opens on. The order is a claim about the panel, not about the
              lesson: what you reach for while watching is the transcript, and
              what you reach for while wondering where this fits is the course —
              which used to be a column that was always in the way and is now the
              first thing on the bar. */}
          <TabsContent
            value="course"
            ref={courseListRef}
            className={`mt-4 min-h-0 flex-1 overflow-y-auto ${NO_SCROLLBAR}`}
          >
            <CourseContents spaceId={spaceId} contentId={contentId} />
          </TabsContent>

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
              onSeek={playFrom}
              selection={draft}
              selectionColor={editingLoop ? loopColor(editingLoop) : "#6366f1"}
              onSelectLine={draft ? selectLine : undefined}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent
            value="notes"
            className={`mt-4 min-h-0 flex-1 overflow-y-auto ${NO_SCROLLBAR}`}
          >
            <NotesTab content={content} spaceId={spaceId} canEdit={canEdit} />
          </TabsContent>

          <TabsContent
            value="files"
            className={`mt-4 min-h-0 flex-1 overflow-y-auto ${NO_SCROLLBAR}`}
          >
            <ContentFiles contentId={content.contentId} canEdit={canEdit} />
          </TabsContent>

          <TabsContent
            value="loops"
            className={`mt-4 min-h-0 flex-1 overflow-y-auto ${NO_SCROLLBAR}`}
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
              onShare={(loop) => void shareLoop(loop)}
              viewerId={viewerId}
              onSeek={playFrom}
              canEdit={canEdit}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
