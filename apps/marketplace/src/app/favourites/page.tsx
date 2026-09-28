'use client';

import Link from 'next/link';
import { HeartIcon } from 'lucide-react';
import { useFavourites, useSpace, useThumbnail, useVideo } from '@play/api';
import { AuthGate } from '@play/auth';
import { ContentFavourite } from '@learning/components/content/content-favourite';
import { spaceAccentColor } from '@learning/components/space/space-avatar';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import type { Content, Space } from '@play/types';
import { marketplaceLearningRoutes } from '@/lib/routes';

/**
 * The lessons this reader has hearted.
 *
 * Read from their own favourites rather than from the catalog, because that is
 * the whole point of a heart: what you kept is yours whether or not its author
 * ever listed the course in public. The heart travels with the lesson rather
 * than being kept here, so this page writes nothing the lesson page does not
 * already know — it lists them, and it lets one go.
 *
 * The heart and the course's accent are imported by their own paths rather than
 * from `@play/learning`'s barrel, which is the classroom and everything under it
 * — the player, the HLS engine, the notes editor. Measured, importing them from
 * the barrel made this page 604 kB of JavaScript against 317 kB, which is a
 * great deal to pay for a card the size of a thumbnail.
 */
export default function FavouritesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Favourites</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          The lessons you have hearted, and the courses they came from.
        </p>
      </header>

      {/* Like "my learning", this page is entirely about the reader, so it opens
          with a sign-in rather than something to read first. */}
      <AuthGate>
        <HeartedLessons />
      </AuthGate>
    </div>
  );
}

function HeartedLessons() {
  const { data, isLoading } = useFavourites('CONTENT');

  /**
   * Newest first.
   *
   * The API orders a learner's favourites by target key, which — ids being
   * ULIDs — is the order the *lessons* were written in rather than the order
   * they were hearted in. That is the right order for a profile; this page is
   * what you kept, and the one you kept last is the one you came back for. The
   * row carries the moment it was hearted, so the sort is one line here rather
   * than an index over there.
   *
   * The read has already been narrowed to lessons and `resolveFavourites` drops
   * a favourite whose lesson is gone, so every entry has its content — the
   * `flatMap` is what says that to the compiler, rather than each card asking.
   */
  const lessons = (data?.favourites ?? [])
    .flatMap((entry) =>
      entry.content ? [{ content: entry.content, heartedAt: entry.createdAt }] : [],
    )
    .sort((a, b) => b.heartedAt - a.heartedAt);

  if (isLoading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-56 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (lessons.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <HeartIcon className="size-6 text-muted-foreground/50" />
        <p className="text-lg font-medium tracking-tight">Nothing hearted yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Tap the heart beside a lesson and it will be kept here.
        </p>
        <Button asChild className="mt-2">
          <Link href="/discover">Discover courses</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* A grid, and the same one "my learning" is: what a reader keeps is a
          collection of videos, and a video is recognised by its picture long
          before its title is read. It is the reason each card goes to the
          trouble of a poster. */}
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {lessons.map(({ content }) => (
          <HeartedLesson key={content.contentId} content={content} />
        ))}
      </ul>

      {/* A page that stopped at a hundred without saying so would be a page
          hiding the video somebody was looking for — the same reason the API
          keys screen asks for everything it is allowed to ask for. */}
      {data?.nextToken ? (
        <p className="mt-8 text-xs text-muted-foreground">
          Showing the first {lessons.length}. You have hearted more than one page of lessons.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One hearted lesson, as a card: its poster, what it is called, and the course it
 * came from.
 *
 * The heart sits over the picture rather than in a row of its own, which is what
 * a video card does everywhere else — it is the thing you press on a card you
 * have already decided about, and the title is the thing you press to watch it.
 * They are siblings for that reason: a control inside the link would be a press
 * that watches the video and saves it at once.
 */
function HeartedLesson({ content }: { content: Content }) {
  const { data } = useSpace(content.spaceId);
  const space = data?.space;

  return (
    <li className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors hover:border-ring/50">
      <Link href={marketplaceLearningRoutes.lesson(content.spaceId, content.contentId)}>
        <LessonPoster content={content} space={space} />

        <div className="grid gap-1.5 p-4">
          <p className="line-clamp-2 text-sm font-semibold">{content.title}</p>
          {/* The course is a line of the card rather than a link of its own: the
              card is a way into the lesson, and a second link inside it would be
              a small target beside a large one that goes somewhere else. */}
          {space ? (
            <p className="truncate text-xs text-muted-foreground">{space.title}</p>
          ) : null}
        </div>
      </Link>

      <div className="absolute right-2 top-2">
        {/* Hearted by definition: the card is here because it is, and pressing
            the heart is what takes it away — a moment later, when the list has
            been read again. The heart alone: over a picture, in a grid of a
            dozen pictures, a count is a number written on a thumbnail. */}
        <ContentFavourite
          contentId={content.contentId}
          favourited
          count={content.favouriteCount}
          showCount={false}
        />
      </div>
    </li>
  );
}

/**
 * The card's picture: the video's own poster when there is one, and the course's
 * colour with the lesson's initial when there is not.
 *
 * The video is read for its `thumbnailKey` *before* the poster is asked for. The
 * thumbnail endpoint answers 404 for a video whose frame has not been captured
 * yet or whose poster was never set, and asking anyway would spend a failed
 * request on every such card rather than one successful request that says so.
 *
 * The fallback is the one a course card draws with, for the same reason: a card
 * is recognised by its colour at a glance, and a lesson with no picture is still
 * a lesson of *that* course. The colour is derived from the course's id, so it
 * is there before the course itself is — the read behind this page is a list of
 * lessons, and a card that waited for a second request to show anything would be
 * a grid of grey boxes on a slow morning.
 */
function LessonPoster({ content, space }: { content: Content; space: Space | undefined }) {
  const { data: videoRes } = useVideo(content.videoId ?? '');
  const video = videoRes?.video;

  const { data: thumbnail } = useThumbnail(
    content.videoId ?? '',
    Boolean(content.videoId && video?.thumbnailKey),
  );

  const accent = spaceAccentColor(space ?? content);

  return (
    <div className="relative aspect-video w-full overflow-hidden border-b">
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnail.thumbnailUrl}
          alt={content.title}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}66 100%)` }}
        >
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-white/90">
            {content.title.trim()[0]?.toUpperCase() ?? '?'}
          </div>
        </div>
      )}
    </div>
  );
}
