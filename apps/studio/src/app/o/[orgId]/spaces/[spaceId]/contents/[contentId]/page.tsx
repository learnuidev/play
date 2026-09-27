'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useOrganization } from '@api/modules/organization/organization.queries';
import { Classroom } from '@play/learning';
import { studioLearningRoutes } from '@/lib/routes';

/**
 * A lesson, in the community it belongs to.
 *
 * The lesson itself is the shared classroom — the same one the marketplace
 * renders — and what the studio adds is what an author needs and a learner does
 * not: their organization, and the right to change what they are looking at. A
 * viewer reads the same page with the editing controls off.
 */
export default function LessonPage() {
  const { orgId, spaceId, contentId } = useParams<{
    orgId: string;
    spaceId: string;
    contentId: string;
  }>();

  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== 'VIEWER' : false;

  // Memoized because the classroom hands it to every link it draws: a new object
  // on every render would re-render the outline under it.
  const routes = useMemo(() => studioLearningRoutes(orgId), [orgId]);

  return (
    <Classroom
      spaceId={spaceId}
      contentId={contentId}
      orgId={orgId}
      canEdit={canEdit}
      routes={routes}
    />
  );
}
