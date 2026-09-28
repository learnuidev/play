'use client';

import { PageCard } from '@/components/shell/page-card';
import { ProfileForm } from '@/components/profile/profile-form';

/**
 * Who you are, on the screens other people read.
 *
 * Not a settings page: there is nothing here to configure. A name, a face, a
 * sentence and a handful of links, which together are the only thing the
 * marketplace knows about a person — it is what a course page credits and what
 * the page behind that name draws. Everything a *course* says about itself is
 * the course's own screen, and everything the account can do is the account
 * menu: this page is the one part of the product that is about the person
 * rather than about their work.
 */
export default function ProfilePage() {
  return (
    <PageCard
      title="Your profile"
      description="What learners see beside the courses you teach. Your name and photo travel with every course."
    >
      <ProfileForm />
    </PageCard>
  );
}
