import type { Metadata } from 'next';
import { Landing } from '@/components/landing';

export const metadata: Metadata = {
  title: 'Play Studio — make a course people finish',
  description:
    'Upload the video, write the lessons, invite the people taking them — and publish to Play Marketplace, where the classroom remembers where they stopped.',
};

/**
 * The front door.
 *
 * Not the app. Somebody arriving here has usually never heard of Play, and the
 * thing they would otherwise land on — the community they belong to, or a form
 * asking them to create one — answers a question they have not asked yet. So the
 * front page says what the studio is for, what a course looks like in it, and
 * where the API is, and the app itself is one link away at `/home`.
 *
 * The page itself is `Landing`'s business; this file exists for the metadata and
 * for the route.
 */
export default function HomePage() {
  return <Landing />;
}
