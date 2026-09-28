/**
 * Taking a course, and listing one.
 *
 * Curated rather than `export *` of every file beside it. This package holds
 * screens that carry real weight — the player and its HLS engine, the TipTap
 * editor behind the notes, the authoring dialogs — and a barrel that re-exported
 * all of them would put every one of those in the bundle of any page that
 * imported the classroom alone. Measured, that is about 130 kB of JavaScript a
 * lesson page never renders.
 *
 * So the barrel is the package's public surface: the classroom, the routes it
 * asks the app for, and the card a course is listed with. Everything else — the
 * transcript, the loops, the outline, the heart the classroom draws, the
 * authoring dialogs — is imported by its own path, which is what the studio's
 * screens and the marketplace's favourites page already do.
 */
export * from './classroom';
export * from './lib/learning-routes';
export * from './components/space/space-avatar';
export * from './components/space/space-type-badge';
export * from './components/space/space-card';
