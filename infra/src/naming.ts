/**
 * Turning the keys in the generated service table into names.
 *
 * A function key is a string like `list-videos` or `oauth-create-app`, and it
 * turns up in three places that each want a different shape: a Lambda name
 * (`play-dev-list-videos`), a CloudFormation logical id (`ListVideosFunction`)
 * and, for a table, a name (`play-dev-videos-table`). Deriving all three from
 * one key is what makes a rename a one-place change and a search a single
 * string.
 */

/** `VideosTable` → `videos-table`. */
export function kebab(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** `list-videos` → `ListVideos`. */
export function pascal(key: string): string {
  return key
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
