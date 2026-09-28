import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import type {
  CreateOAuthAppPayload,
  OAuthApp,
  OAuthAuthorizationParams,
  UpdateOAuthAppPayload,
} from '@play/types';

export const oauthKeys = {
  all: ['oauth'] as const,
  apps: () => ['oauth', 'apps'] as const,
  app: (appId: string) => ['oauth', 'apps', appId] as const,
  connections: () => ['oauth', 'connections'] as const,
  /**
   * Keyed by the authorization request itself, so two requests are two answers.
   *
   * Every parameter that changes what the API would answer with is in the key,
   * `state` and the PKCE challenge included: two requests from the same client to
   * the same URI are still two requests, and a key that dropped the difference
   * would let one screen's answer be shown for another's.
   */
  authorization: (params: OAuthAuthorizationParams) =>
    [
      'oauth',
      'authorization-request',
      params.client_id,
      params.redirect_uri,
      params.scope ?? '',
      params.state ?? '',
      params.code_challenge,
      params.code_challenge_method,
    ] as const,
};

/**
 * What a consent screen is being asked for.
 *
 * The one query in this package that is deliberately **not** cached: an
 * authorization request is a single event in a browser's life, and a description
 * served from a cache would be describing a request other than the one in the
 * address bar. `retry: false` for the same reason — a refusal here is an answer,
 * not a hiccup, and retrying it only delays the screen that explains it.
 *
 * `enabled` is the caller's, because the request is only worth making once
 * somebody is signed in: the API behind it needs a session, and asking before
 * one exists is a 401 dressed up as a broken consent screen.
 */
export function useAuthorizationDescription(
  params: OAuthAuthorizationParams | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: oauthKeys.authorization(params ?? { client_id: '', redirect_uri: '', response_type: '', code_challenge: '', code_challenge_method: '' }),
    queryFn: () => {
      if (!params) throw new Error('This authorization request is incomplete');
      return api.describeAuthorization(params);
    },
    enabled: Boolean(params) && enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * The apps this account has registered.
 *
 * Held for a moment rather than for long, for the reason the key list is: an app
 * list is read to decide something — rotate this secret, fix that redirect URI —
 * and the answer has to be current when the decision is made.
 */
export function useOAuthApps() {
  return useQuery({
    queryKey: oauthKeys.apps(),
    queryFn: () => api.listOAuthApps(),
    staleTime: 30 * 1000,
  });
}

/** One app, in full: its redirect URIs, its scopes, and the prefix of its secret. */
export function useOAuthApp(appId: string) {
  return useQuery({
    queryKey: oauthKeys.app(appId),
    queryFn: () => api.getOAuthApp(appId),
    enabled: Boolean(appId),
    staleTime: 30 * 1000,
  });
}

/**
 * Registers an app and hands back its secret, once.
 *
 * No cache write for the new app, deliberately: what the caller needs from this
 * call is the secret, which is shown once and then gone, and the list is
 * refetched beside it. Caching the response would keep a usable credential in
 * the query cache for as long as the page is open.
 */
export function useCreateOAuthApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateOAuthAppPayload) => api.createOAuthApp(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: oauthKeys.apps() });
    },
  });
}

/**
 * Edits an app.
 *
 * Everything about a scope change is invalidated, including the connections: the
 * API ends every authorization of an app whose scopes changed, so a connections
 * screen left in the cache would be listing apps that no longer hold anything.
 */
export function useUpdateOAuthApp(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateOAuthAppPayload) => api.updateOAuthApp(appId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: oauthKeys.apps() });
      qc.invalidateQueries({ queryKey: oauthKeys.connections() });
    },
  });
}

/** Deletes an app, and takes its authorizations with it on the server's side. */
export function useDeleteOAuthApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => api.deleteOAuthApp(appId),
    onSuccess: (_result, appId) => {
      qc.setQueryData<{ apps: OAuthApp[] }>(oauthKeys.apps(), (current) =>
        current ? { ...current, apps: current.apps.filter((app) => app.appId !== appId) } : current,
      );
      // The app's own query is left where it is: its page is still mounted while
      // the delete resolves and then navigates, and removing the query under it
      // rebuilds the observer and refetches a row that no longer exists — a
      // "not found" card flashed at somebody who has just deleted the thing.
      qc.invalidateQueries({ queryKey: oauthKeys.apps() });
      qc.invalidateQueries({ queryKey: oauthKeys.connections() });
    },
  });
}

/**
 * Rotates an app's client secret.
 *
 * The app is refreshed in the cache — its secret prefix changed — and the secret
 * itself is not cached anywhere: the dialog that shows it holds it until it is
 * closed, and the refetch that follows is what the list reads.
 */
export function useRotateOAuthAppSecret(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.rotateOAuthAppSecret(appId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: oauthKeys.apps() });
    },
  });
}

/** What this account has let in: every app authorized on it. */
export function useOAuthConnections() {
  return useQuery({
    queryKey: oauthKeys.connections(),
    queryFn: () => api.listOAuthConnections(),
    staleTime: 30 * 1000,
  });
}

/**
 * Disconnects an app.
 *
 * The row goes out of the cache the moment the delete succeeds, so the list
 * answers before the refetch does — and the refetch is what makes the rest of
 * the list current. Disconnecting changes nothing about the app itself, so the
 * apps list is left alone.
 */
export function useDeleteOAuthConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => api.deleteOAuthConnection(appId),
    onSuccess: (_result, appId) => {
      qc.setQueryData<{ connections: { appId: string }[] }>(
        oauthKeys.connections(),
        (current) =>
          current
            ? {
                ...current,
                connections: current.connections.filter(
                  (connection) => connection.appId !== appId,
                ),
              }
            : current,
      );
      qc.invalidateQueries({ queryKey: oauthKeys.connections() });
    },
  });
}
