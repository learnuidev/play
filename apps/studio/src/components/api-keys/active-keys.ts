import type { ApiKey } from '@play/types';

/**
 * The keys that still work.
 *
 * The API does not return revoked keys, and this is the app saying the same
 * thing rather than assuming it heard. The studio and the API deploy separately,
 * so there is a window where the app is newer than the endpoint it is talking
 * to — and a revoked row in the list is a row whose Revoke button would do
 * nothing, which is a worse answer than not showing it.
 *
 * Generic over the two shapes a list can hold: a key as its owner sees it, and
 * a key as an organization's admin sees it.
 */
export function activeKeys<T extends Pick<ApiKey, 'revokedAt'>>(keys: T[]): T[] {
  return keys.filter((key) => key.revokedAt === undefined);
}
