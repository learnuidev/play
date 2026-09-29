'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useContent } from '@api/modules/content/content.queries';
import { useOrganization } from '@api/modules/organization/organization.queries';
import { Classroom } from '@play/learning';
import { studioLearningRoutes } from '@/lib/routes';
import { QuizPage } from '@/components/quiz/quiz-page';

/**
 * A lesson or a quiz, in the community it belongs to.
 *
 * The lesson itself is the shared classroom — the same one the marketplace
 * renders — and what the studio adds is what an author needs and a learner does
 * not: their organization, and the right to change what they are looking at. A
 * viewer reads the same page with the editing controls off.
 *
 * One route serves both kinds of content, and the app decides between them here
 * rather than inside the classroom. A quiz is not a lesson with a missing video:
 * it is a list of questions to write and review, and none of what the classroom
 * is built around — the player, the transcript, the loops, the discussion of a
 * moment in the video — has anything to do with it. The route stays the lesson
 * route because the outline links to content the same way whichever kind it is,
 * and an author arranging a course should not have to remember which kind lives
 * at which URL.
 *
 * Until the content arrives there is no way to know which page this is, so the
 * classroom draws the loading state: it is the commoner kind, and it reads the
 * same query, so nothing is fetched twice to find out.
 */
export default function LessonPage() {
  const { orgId, spaceId, contentId } = useParams<{
    orgId: string;
    spaceId: string;
    contentId: string;
  }>();

  const { data } = useContent(contentId);
  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== 'VIEWER' : false;

  // Memoized because the classroom hands it to every link it draws: a new object
  // on every render would re-render the outline under it.
  const routes = useMemo(() => studioLearningRoutes(orgId), [orgId]);

  if (data?.content.type === 'QUIZ') {
    return <QuizPage />;
  }

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
