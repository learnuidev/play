import { StudioPageHeader } from '@/components/studio/page-header';
import { UploadForm } from '@/components/studio/upload-form';
import { Card, CardContent } from '@/components/ui/card';

export default function NewVideoPage() {
  return (
    <div className="flex h-svh flex-col">
      <StudioPageHeader title="New video" description="Upload a video to start encoding and transcription." />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-8">
          <Card className="rounded-2xl">
            <CardContent className="pt-6">
              <UploadForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
