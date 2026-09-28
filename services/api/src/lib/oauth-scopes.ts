import type { ApiCaller, ApiScope } from '../types';
import { HttpError } from './http';

/**
 * Scopes: what an app may be allowed to do on somebody's behalf.
 *
 * An API key answers one question — "what does this credential reach" — with a
 * fixed answer chosen once, when the key is made: the public catalog, and one
 * organization's courses if the key names one. That is a whole credential's
 * worth of permission for an integration that usually wants a fraction of it,
 * and it is the reason keys were described as too blunt.
 *
 * A scope is that question asked in smaller pieces. Five of them exist, and each
 * one is a sentence somebody reads on a consent screen — which is the real
 * constraint on how many there are and how finely they are cut. `lessons:read`
 * and `lessons:stream` are separate scopes for exactly that reason: listing a
 * course and playing its video are different things to agree to, and the second
 * is the one that costs this service bandwidth.
 *
 * This module is the catalogue and nothing else: which scopes exist, which of
 * them a route demands, and which of them a credential holds. Every `/v1`
 * handler names the scope it needs (`requireScope`), so the answer to "what does
 * this endpoint require" is a line in the handler rather than a second table
 * here that a new route can forget to be added to.
 */

/**
 * Every scope there is.
 *
 * The order is the order a consent screen shows them in: the person's own
 * account first, then the catalog, then the parts of a course, then the widest
 * one, which is the only scope that reaches anything that is not public.
 */
export const API_SCOPES: ApiScope[] = [
  'profile:read',
  'courses:read',
  'lessons:read',
  'lessons:stream',
  'organization:courses:read',
];

/**
 * What an API key holds, which is the reach keys have always had.
 *
 * Expressed as scopes rather than special-cased, so that a handler asks one
 * question — "does this caller hold `courses:read`" — and gets an answer for
 * either kind of credential. A key does not hold `profile:read`: a key is a
 * script's credential and there is no *person* reading a consent screen to have
 * agreed to anything about their account, which is the same reason the key's own
 * identity response has never carried a profile.
 */
export const KEY_SCOPES: ApiScope[] = ['courses:read', 'lessons:read', 'lessons:stream'];

/**
 * The scope that widens a credential beyond the public catalog.
 *
 * Held by a key only when its owner named an organization, and by an app only
 * when the person authorizing it agreed to it.
 */
export const ORGANIZATION_SCOPE: ApiScope = 'organization:courses:read';

/** Whether a string is a scope this service knows. */
export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as string[]).includes(value);
}

/** A scope list as OAuth writes it: space-delimited. */
export function formatScopeList(scopes: ApiScope[]): string {
  return scopes.join(' ');
}

/**
 * Demands a scope of a caller, and answers 403 when they do not hold it.
 *
 * The refusal names the scope rather than saying "forbidden", and that is the
 * one place this API is deliberately talkative: an integration that has run out
 * of permission needs to know *which* permission to ask its user for, and the
 * scope is not a secret — it is a line on a consent screen.
 */
export function requireScope(caller: ApiCaller, scope: ApiScope): void {
  if (caller.scopes.includes(scope)) return;
  throw new HttpError(403, `This credential is missing the ${scope} scope`);
}

