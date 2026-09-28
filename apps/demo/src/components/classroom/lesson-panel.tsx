'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  HeartIcon,
  Loader2Icon,
  MessageSquareIcon,
  NotebookPenIcon,
  TriangleAlertIcon,
  VideoOffIcon,
} from 'lucide-react';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Separator } from '@ui/components/ui/separator';
import { Skeleton } from '@ui/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ui/components/ui/tabs';
import { AnimatedTranscript } from '@learning/components/content/animated-transcript';
import { VideoPlayer, type VideoPlayerHandle } from '@learning/components/video-player';
import { buildTranscriptLines } from '@learning/lib/transcript';
import { parseVtt } from '@learning/lib/vtt';
import {
  ApiError,
  getAttachments,
  getLesson,
  getStream,
  getSubtitles,
  setLessonCompletion,
  setLessonFavourite,
} from '@/lib/api/v1';
import { notesToText } from '@/lib/api/notes';
import { Discussion } from './discussion';
import { useAsync } from '@/lib/use-async';

/**
 * One lesson: the video, and everything the API will say about it.
 *
 * This is the part of the demo that is worth looking at closely, because it is
 * the same player and the same transcript the studio and the marketplace draw —
 * imported from the shared package, unchanged. What is *not* the same is where
 * the data comes from: five calls to the public API, with a bearer token, and no
 * session, no cookies and no knowledge of Play's own database.
 *
 * The five, and the scope each one needs:
 *
 * | Call | Needs |
 * | --- | --- |
 * | `GET /v1/lessons/{id}` | `lessons:read` — the title, the notes as a ProseMirror document, the poster |
 * | `GET /v1/lessons/{id}/stream` | `lessons:stream` — a signed HLS manifest, and the query every segment needs |
 * | `GET /v1/lessons/{id}/subtitles` | `lessons:stream` — signed WebVTT URLs, and every word with when it is said |
 * | `GET /v1/lessons/{id}/attachments` | `lessons:read` — the worksheets beside the video |
 *
 * Two of the four are fetched in the same breath at the top and the other two
 * only when their tab is opened, which is the same shape Play's own classroom
 * uses: a lesson is watched first, and its material is read afterwards.
 */
export function LessonPanel({
  contentId,
  nextLesson,
  state,
  viewerId,
  onStateChange,
}: {
  contentId: string;
  nextLesson?: { contentId: string; title: string };
  /** What this person has done with this lesson, as `/v1/me/learning` said. */
  state: { completed: boolean; favourited: boolean };
  /** The credential's own `userId`, so the discussion can mark their comments. */
  viewerId?: string;
  /** Called after a write lands, so the outline's own marks stay in step. */
  onStateChange: (next: { completed?: boolean; favourited?: boolean }) => void;
}) {
  const lesson = useAsync(() => getLesson(contentId), [contentId]);
  const player = useRef<VideoPlayerHandle>(null);

  /**
   * The stream, when there is one.
   *
   * A lesson without a video answers 404 here, and one that is still being
   * encoded answers 409 — both are ordinary states of a draft, not failures, so
   * they are turned into "there is nothing to play" rather than into an error
   * panel that makes the page look broken.
   */
  const stream = useAsync(
    () =>
      getStream(contentId).catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 404 || err.status === 409)) return null;
        throw err;
      }),
    [contentId],
  );

  const subtitles = useAsync(
    () =>
      getSubtitles(contentId).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) return null;
        throw err;
      }),
    [contentId],
  );

  const notes = useMemo(() => notesToText(lesson.data?.notes), [lesson.data]);

  /**
   * The three writes, each with its own pending flag and its own error.
   *
   * Deliberately not one shared "saving…": a person pressing Save while a
   * completion is in flight should see the heart move and the tick still
   * working, and one error message for both would say the wrong thing about
   * which call failed. The errors are shown as the API wrote them — a 403 that
   * names a missing scope is the most useful sentence on this page, because it
   * says exactly which permission the app was not given.
   */
  const [pending, setPending] = useState<null | 'completion' | 'favourite'>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(which: 'completion' | 'favourite', work: () => Promise<void>) {
    setPending(which);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setPending(null);
    }
  }

  function toggleCompletion() {
    const next = !state.completed;
    void run('completion', async () => {
      const answer = await setLessonCompletion(contentId, next);
      onStateChange({ completed: answer.completed });
    });
  }

  function toggleFavourite() {
    const next = !state.favourited;
    void run('favourite', async () => {
      const answer = await setLessonFavourite(contentId, next);
      onStateChange({ favourited: answer.favourited });
    });
  }

  if (lesson.loading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (lesson.error || !lesson.data) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium">That lesson could not be read</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {lesson.error?.message ?? 'The API did not return it.'}
          </p>
        </div>
      </div>
    );
  }

  const current = lesson.data;

  return (
    <div className="grid gap-6">
      {stream.loading ? (
        <Skeleton className="aspect-video w-full rounded-2xl" />
      ) : stream.data ? (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-black">
          <VideoPlayer
            ref={player}
            src={stream.data.manifestUrl}
            signedQuery={stream.data.signedQuery}
            {...(current.thumbnailUrl ? { poster: current.thumbnailUrl } : {})}
            tracks={(subtitles.data?.tracks ?? []).map((track) => ({
              src: track.subtitleUrl,
              srcLang: track.language,
              label: track.label,
            }))}
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/30 text-center">
          <VideoOffIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No video on this lesson</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            The lesson exists and its material is below; there is simply nothing to play. Play
            answers 404 for a lesson with no video and 409 for one that is still being encoded, and
            this app treats both as states rather than failures.
          </p>
        </div>
      )}

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            Lesson {current.position}
          </Badge>
          {current.fileCount > 0 && (
            <Badge variant="outline" className="font-normal">
              {current.fileCount} {current.fileCount === 1 ? 'file' : 'files'}
            </Badge>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{current.title}</h1>

        {/*
          The two things this app can *do* with a lesson, and the state of each.
          Both are writes under `/v1`, both need `learning:write`, and both are
          idempotent — so a double press is a toggle that has already happened
          rather than a second completion.
        */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={state.completed ? 'default' : 'secondary'}
            size="sm"
            onClick={toggleCompletion}
            disabled={pending !== null}
            aria-pressed={state.completed}
          >
            {pending === 'completion' ? (
              <Loader2Icon className="animate-spin" />
            ) : state.completed ? (
              <CheckCircle2Icon />
            ) : (
              <CheckIcon />
            )}
            {state.completed ? 'Completed' : 'Mark complete'}
          </Button>

          <Button
            type="button"
            variant={state.favourited ? 'default' : 'secondary'}
            size="sm"
            onClick={toggleFavourite}
            disabled={pending !== null}
            aria-pressed={state.favourited}
          >
            {pending === 'favourite' ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <HeartIcon className={state.favourited ? 'fill-current' : undefined} />
            )}
            {state.favourited ? 'Saved' : 'Save'}
          </Button>

          <span className="text-xs text-muted-foreground">
            Written to your own record at Play, with <span className="font-mono">learning:write</span>.
          </span>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <p className="text-xs leading-relaxed text-muted-foreground">{error}</p>
          </div>
        )}
      </div>

      <Tabs defaultValue={notes ? 'notes' : 'transcript'}>
        <TabsList>
          <TabsTrigger value="notes">
            <NotebookPenIcon className="size-4" />
            About
          </TabsTrigger>
          <TabsTrigger value="transcript">
            Transcript
          </TabsTrigger>
          <TabsTrigger value="material">
            <FileTextIcon className="size-4" />
            Material
          </TabsTrigger>
          <TabsTrigger value="discussion">
            <MessageSquareIcon className="size-4" />
            Discussion
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notes" className="mt-5">
          {notes ? (
            <div className="grid gap-4">
              {notes.split('\n\n').map((paragraph, index) => (
                <p key={index} className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
              <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                These came from <span className="font-mono">GET /v1/lessons/{contentId}</span> as
                the document the author wrote — a ProseMirror tree, not HTML. This app has no
                editor, so it walks the tree and takes the words out; a caller with an editor
                renders the structure instead.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">The author wrote no notes here.</p>
          )}
        </TabsContent>

        <TabsContent value="transcript" className="mt-5">
          <TranscriptTab
            contentId={contentId}
            subtitles={subtitles.data ?? undefined}
            loading={subtitles.loading}
            error={subtitles.error}
            player={player}
            hasVideo={Boolean(stream.data)}
          />
        </TabsContent>

        <TabsContent value="material" className="mt-5">
          <MaterialTab contentId={contentId} fileCount={current.fileCount} />
        </TabsContent>

        <TabsContent value="discussion" className="mt-5">
          <Discussion contentId={contentId} {...(viewerId ? { viewerId } : {})} />
        </TabsContent>

      </Tabs>

      {nextLesson && (
        <>
          <Separator />
          <Button asChild variant="secondary" className="w-fit">
            <Link href={`?lesson=${nextLesson.contentId}`} scroll={false}>
              Next: {nextLesson.title}
              <ArrowRightIcon />
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The transcript: the same component Play's own classroom draws.
 *
 * Two calls behind it and one fetch in front of it. The API hands over signed
 * WebVTT URLs and the word timings, and this app fetches the caption file,
 * parses it with the shared parser and builds the same animated lines the
 * classroom uses — `getTime` read off the player once a frame, so the fill lands
 * on the word being said rather than smearing a line at a time.
 *
 * Nothing here is Play-specific, which is the point: a third party builds this
 * from the public API and two shared helpers.
 */
function TranscriptTab({
  contentId,
  subtitles,
  loading,
  error,
  player,
  hasVideo,
}: {
  contentId: string;
  subtitles: Awaited<ReturnType<typeof getSubtitles>> | undefined;
  loading: boolean;
  error: Error | undefined;
  player: React.RefObject<VideoPlayerHandle | null>;
  hasVideo: boolean;
}) {
  const source = subtitles?.tracks.find((track) => track.isSource) ?? subtitles?.tracks[0];
  const [vtt, setVtt] = useState<string | null>(null);
  const [vttError, setVttError] = useState<string | null>(null);

  useEffect(() => {
    setVtt(null);
    setVttError(null);
    if (!source) return;

    let cancelled = false;
    // The caption file itself, from the signed URL the API handed over. It is a
    // cross-origin read of CloudFront, which is why the licence is a signed URL
    // rather than a cookie: nothing about this app is known to the media host.
    fetch(source.subtitleUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`The caption file answered ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setVtt(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setVttError(err instanceof Error ? err.message : 'The captions could not be read');
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  const lines = useMemo(() => {
    if (!vtt) return [];
    // Word timings are the source script's own, and they are what make the fill
    // land word by word rather than spreading across the cue.
    return buildTranscriptLines(parseVtt(vtt), source?.isSource ? subtitles?.words : undefined);
  }, [source?.isSource, subtitles?.words, vtt]);

  if (loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-5 w-full max-w-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorLine message={error.message} />;
  }

  if (!source) {
    return (
      <p className="text-sm text-muted-foreground">
        This lesson has no captions yet
        {hasVideo ? '' : ' — and no video either'}.
      </p>
    );
  }

  if (vttError) {
    return <ErrorLine message={vttError} />;
  }

  if (!vtt) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Reading the caption file…
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <AnimatedTranscript
        lines={lines}
        getTime={() => player.current?.getTimeMs() ?? 0}
        onSeek={(timeMs) => {
          player.current?.seekTo(timeMs);
          player.current?.play();
        }}
        className="max-h-[26rem]"
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {lines.length} lines, from{' '}
        <span className="font-mono">GET /v1/lessons/{contentId}/subtitles</span> — which gave this
        app a signed URL for the captions and every word with when it is said. Click a line to seek
        the video to it.
      </p>
    </div>
  );
}

/** The files attached to a lesson, each with the signed URL the API minted. */
function MaterialTab({ contentId, fileCount }: { contentId: string; fileCount: number }) {
  const attachments = useAsync(() => getAttachments(contentId), [contentId]);

  if (fileCount === 0) {
    return <p className="text-sm text-muted-foreground">Nothing is attached to this lesson.</p>;
  }

  if (attachments.loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (attachments.error) {
    return <ErrorLine message={attachments.error.message} />;
  }

  const files = attachments.data?.attachments ?? [];
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing is attached to this lesson.</p>;
  }

  return (
    <ul className="grid gap-2">
      {files.map((file) => (
        <li
          key={file.fileId}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 px-4 py-3"
        >
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {file.contentType}
              {file.size ? ` · ${Math.round(file.size / 1024)} KB` : ''}
            </p>
          </div>
          {file.url && (
            <Button asChild variant="secondary" size="sm">
              <a href={file.url} target="_blank" rel="noreferrer noopener">
                <DownloadIcon />
                Open
              </a>
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <p className="text-xs leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}
