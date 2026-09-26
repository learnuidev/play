import { StudioPageHeader } from '@/components/studio/page-header';
import { OrganizationForm } from '@/components/studio/organization-form';
import { Card, CardContent } from '@/components/ui/card';

export default function NewOrganizationPage() {
  return (
    <div className="flex h-svh flex-col">
      <StudioPageHeader
        title="New organization"
        description="Create a workspace for your courses and teammates."
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-8">
          <Card className="rounded-2xl">
            <CardContent className="pt-6">
              <OrganizationForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
