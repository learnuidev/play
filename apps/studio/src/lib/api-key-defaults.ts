'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@play/api';

/**
 * The values an organization's key already knows the answer to.
 *
 * A key made for an organization reaches that organization and nothing else, and
 * the cards below ask for three things in turn: an organization, a course, and a
 * lesson. The reference prints an example for each of them, and those examples
 * name records that have never existed — which is the right default for a page
 * somebody is reading, and a waste of a key for the page they are testing one on.
 *
 * So the answers are read from the API: the organization is the key's own, the
 * course is the first one that organization has, and the lesson is the first one
 * in that course. Three things a reader would otherwise go and look up on three
 * other screens before coming back to fill in by hand.
 *
 * One query for the whole page. Every card asks the same question, and the
 * answer does not depend on which card asked, so the second card is answered
 * from the first card's request rather than from a second round trip.
 */
export interface ApiKeyDefaults {
  /** The organization the key was made for — the only one it can be used with. */
  orgId?: string;
  /** That organization's first course, which is the newest one it has. */
  spaceId?: string;
  /** The first lesson filed in that course, for the cards that ask for one. */
  contentId?: string;
}

/**
 * What the key in the tab can fill in by itself.
 *
 * `undefined` while it is being read, and when there is nothing to read it as —
 * a personal key, or no key at all. The cards treat both the same way, which is
 * to keep the examples the reference prints.
 *
 * A refusal is deliberately not an error here. Somebody whose key is wrong, or
 * who is only a viewer in that organization, finds out from the card they press
 * Send on: a status and a body, from the endpoint they meant to call. A page that
 * greeted them with a failed request instead would be answering a question they
 * had not asked yet.
 */
export function useApiKeyDefaults(organizationId: string | undefined): ApiKeyDefaults | undefined {
  const query = useQuery({
    queryKey: ['docs', 'key-defaults', organizationId ?? ''],
    enabled: Boolean(organizationId),
    // A course's outline does not change while somebody reads the reference, and
    // a page of nine cards must not ask nine times for the same answer.
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<ApiKeyDefaults> => {
      const orgId = organizationId as string;

      const { spaces } = await api.listSpaces(orgId);
      const course = spaces[0];
      if (!course) return { orgId };

      const { sections } = await api.listSections(course.spaceId);
      const lesson = sections.flatMap((section) => section.contents)[0];

      return {
        orgId,
        spaceId: course.spaceId,
        ...(lesson ? { contentId: lesson.contentId } : {}),
      };
    },
  });

  // `data` rather than `data ?? {}`: the reference is stable between renders,
  // while a fresh object every render would re-run the effects that watch it for
  // as long as the page was open.
  return query.data;
}
