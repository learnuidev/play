'use client';

import { useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { Video } from '@/types';
import { useUpdateVideo } from '@/modules/video/video.queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function VideoGeneralForm({ video }: { video: Video }) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? '');
  const update = useUpdateVideo(video.videoId);

  const dirty = title !== video.title || description !== (video.description ?? '');

  function handleSave() {
    update.mutate(
      { title, description },
      {
        onSuccess: () => toast.success('Video updated'),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Failed to update video'),
      },
    );
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Update the video&apos;s title and description.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="video-title">Title</Label>
          <Input
            id="video-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Video title"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="video-description">Description</Label>
          <Textarea
            id="video-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this video about?"
            rows={4}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button onClick={handleSave} disabled={update.isPending || !dirty || !title.trim()}>
            {update.isPending && <Loader2Icon className="animate-spin" />}
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
