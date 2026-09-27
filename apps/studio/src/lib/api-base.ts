/**
 * Where the API lives, as the browser should address it.
 *
 * One place rather than two, because both the API keys screen and the reference
 * page have to print a URL a caller can paste into a terminal — the key screen
 * so a new key can be tried immediately, the reference so every example is
 * runnable — and two copies of this would be two answers to "where is the API".
 *
 * It is the same value the API client uses (`packages/api` reads
 * `NEXT_PUBLIC_API_URL` too), so what the docs print is what the app itself
 * calls. A deployment that has not set it falls back to a placeholder rather
 * than to nothing: an example with no host in it teaches nobody anything.
 */
const configured = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

export const API_BASE_URL =
  configured || 'https://<your-api-id>.execute-api.<region>.amazonaws.com/dev';

/** Whether the URL above is the real deployment rather than a placeholder. */
export const API_BASE_URL_IS_CONFIGURED = configured.length > 0;

/** A full URL for one of the API's paths, which are written with a leading slash. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
