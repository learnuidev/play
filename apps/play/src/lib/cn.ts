/**
 * Class names, joined.
 *
 * `@play/ui` uses `clsx` + `tailwind-merge`, which is right for a product whose
 * components have to survive being restyled by the app around them. This app is
 * one app with one author and no overrides, so the merge is a dependency that
 * would never fire — and the console deliberately shares nothing with the
 * product's package graph.
 */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
