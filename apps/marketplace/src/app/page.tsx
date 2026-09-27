import type { Metadata } from 'next';
import { Landing } from '@/components/landing';

export const metadata: Metadata = {
  title: 'Play Marketplace — courses worth your evening',
  description:
    'Courses written by communities on Play: watch a lesson, stop in the middle, and pick it up tomorrow where you left it.',
};

/**
 * The front door.
 *
 * Not the catalog. Somebody arriving here has usually never heard of Play, and
 * a list of forty courses is not an answer to "what is this?" — so the front page
 * says what the marketplace is, what a lesson looks like, and what people say
 * about it, and the catalog lives one link away at `/discover`.
 *
 * The page itself is `Landing`'s business; this file exists for the metadata and
 * for the route.
 */
export default function HomePage() {
  return <Landing />;
}
