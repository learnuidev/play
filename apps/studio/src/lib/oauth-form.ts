/**
 * The two settings an OAuth app has that are lists, edited as text.
 *
 * Redirect URIs and scopes are the parts of an app's configuration that are
 * genuinely plural, and both are written here as one-per-line rather than as a
 * row of inputs with an "add" button between them. One-per-line is what somebody
 * pastes, what somebody copies out of a config file, and what a diff of the two
 * looks like a diff — where a widget that built a list one row at a time would
 * put a control between a person and the text they already have.
 *
 * The text is only a view of the value: nothing is stored as a string, both
 * directions are pure, and the pages that use them keep the array as the state
 * they send.
 *
 * Nothing here validates a URI. The API does that, against the same rules it
 * applies to its own storage — which scheme, which host, no fragment — and a
 * second, weaker copy of those rules on this side would be a form that refuses
 * something the service would accept, or worse, one that accepts something the
 * service then rejects with a message about a line the reader cannot pick out.
 */

/** One URI per line, trimmed, blank lines dropped, duplicates collapsed. */
export function redirectUrisFromText(text: string): string[] {
  const uris = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return [...new Set(uris)];
}

/** The same list back as text, for the box somebody edits. */
export function redirectUrisToText(uris: string[]): string {
  return uris.join('\n');
}
