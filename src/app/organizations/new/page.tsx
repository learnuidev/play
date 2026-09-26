import { PageCard } from '@/components/shell/page-card';
import { OrganizationForm } from '@/components/organization/organization-form';

export default function NewOrganizationPage() {
  return (
    <PageCard
      title="New organization"
      description="A workspace for your videos, courses, and teammates."
    >
      <OrganizationForm />
    </PageCard>
  );
}
