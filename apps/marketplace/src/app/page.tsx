import { Catalog } from "@/components/catalog";

/**
 * The marketplace's front page.
 *
 * `?query=` is the search, and it is read here, on the server: the URL is the
 * only place a search lives, so a shared link — `/?query=film` — renders its
 * results in the first response instead of correcting itself once the browser is
 * awake. Everything under the hero is client-rendered, because the catalog
 * itself is fetched from the API in the browser.
 */
export default function CatalogPage({
  searchParams,
}: {
  /** A repeated parameter arrives as an array, which a search never is. */
  searchParams: { query?: string | string[] };
}) {
  const query = typeof searchParams.query === "string" ? searchParams.query.trim() : "";

  return <Catalog query={query} />;
}
