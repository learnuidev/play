import type { Metadata } from 'next';
import { Catalog } from '@/components/catalog';

export const metadata: Metadata = {
  title: 'Discover — Play Marketplace',
  description: 'Every course published by communities on Play, with one box to look through them with.',
};

/**
 * Discover: everything published, and one box to look through it with.
 *
 * `?query=` is the search, and it is read here, on the server: the URL is the
 * only place a search lives, so a shared link — `/discover?query=film` — renders
 * its results in the first response instead of correcting itself once the
 * browser is awake. Everything under the hero is client-rendered, because the
 * catalog itself is fetched from the API in the browser.
 *
 * This was `/` once. The catalog is a page you *go to* rather than a front door,
 * so it moved: somebody who has never heard of Play should meet a sentence about
 * the thing before they meet a table of contents.
 */
export default function DiscoverPage({
  searchParams,
}: {
  /** A repeated parameter arrives as an array, which a search never is. */
  searchParams: { query?: string | string[] };
}) {
  const query = typeof searchParams.query === 'string' ? searchParams.query.trim() : '';

  return <Catalog query={query} />;
}
