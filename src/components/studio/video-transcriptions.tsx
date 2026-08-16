'use client';

import { useState } from 'react';
import { CaptionsIcon, LanguagesIcon, Loader2Icon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TRANSLATION_LANGUAGES } from '@/types';
import type { Video } from '@/types';
import { useGenerateSubtitles, useSubtitles } from '@/modules/subtitle/subtitle.queries';
import { useGenerateTranslations } from '@/modules/translations/translations.queries';
import { SubtitleEditor } from '@/components/subtitle-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const SUBTITLE_STATUS: Record<string, { label: string; className: string }> = {
  NONE: { label: 'None', className: 'text-muted-foreground' },
  GENERATING: { label: 'Generating…', className: 'text-amber-400' },
  READY: { label: 'Ready', className: 'text-emerald-400' },
  FAILED: { label: 'Failed', className: 'text-destructive' },
};

export function VideoTranscriptions({ video }: { video: Video }) {
  const [selected, setSelected] = useState<string[]>(TRANSLATION_LANGUAGES.map((l) => l.bcp47));

  const subtitleStatus = video.subtitleStatus ?? 'NONE';
  const subtitlesReady = subtitleStatus === 'READY' && !!video.subtitleKey;

  const { data: subtitle, isLoading: loadingSubtitle } = useSubtitles(
    video.videoId,
    subtitlesReady,
  );
  const generate = useGenerateSubtitles(video.videoId);
  const translate = useGenerateTranslations(video.videoId);

  function handleGenerate() {
    generate.mutate(undefined, {
      onSuccess: () => toast.success('Subtitle generation started'),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to generate subtitles'),
    });
  }

  function toggleLanguage(bcp47: string) {
    setSelected((prev) =>
      prev.includes(bcp47) ? prev.filter((l) => l !== bcp47) : [...prev, bcp47],
    );
  }

  function handleTranslate() {
    if (selected.length === 0) return;
    translate.mutate(selected, {
      onSuccess: () => toast.success('Translations generated'),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to generate translations'),
    });
  }

  return (
    <div className="grid gap-6">
      <Card className="rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CaptionsIcon className="size-4 text-muted-foreground" />
              <CardTitle>Transcript</CardTitle>
            </div>
            <span className={cn('text-xs font-medium', SUBTITLE_STATUS[subtitleStatus]?.className)}>
              {SUBTITLE_STATUS[subtitleStatus]?.label ?? subtitleStatus}
            </span>
          </div>
          <CardDescription>
            The source subtitles are generated from your video&apos;s audio, then edited here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subtitleStatus === 'NONE' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                This video doesn&apos;t have subtitles yet. Generate them from the audio.
              </p>
              <Button onClick={handleGenerate} disabled={generate.isPending}>
                {generate.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                {generate.isPending ? 'Starting…' : 'Generate subtitles'}
              </Button>
            </div>
          )}

          {subtitleStatus === 'FAILED' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-destructive">Subtitle generation failed.</p>
              <Button onClick={handleGenerate} disabled={generate.isPending}>
                {generate.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                {generate.isPending ? 'Starting…' : 'Regenerate subtitles'}
              </Button>
            </div>
          )}

          {subtitleStatus === 'GENERATING' && (
            <div className="flex items-center gap-3 py-6 text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              <span className="text-sm">Generating subtitles from the audio…</span>
            </div>
          )}

          {subtitleStatus === 'READY' &&
            (loadingSubtitle ? (
              <div className="grid gap-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : subtitle ? (
              <SubtitleEditor videoId={video.videoId} initialContent={subtitle.content} />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Could not load subtitles.
              </p>
            ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <LanguagesIcon className="size-4 text-muted-foreground" />
            <CardTitle>Translations</CardTitle>
          </div>
          <CardDescription>
            Generate the transcript in multiple languages so viewers can pick their own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subtitleStatus !== 'READY' ? (
            <p className="py-4 text-sm text-muted-foreground">
              Generate the transcript first, then you can translate it.
            </p>
          ) : (
            <div className="grid gap-5">
              <div className="flex flex-wrap gap-2">
                {TRANSLATION_LANGUAGES.map((lang) => {
                  const translation = video.translations?.[lang.bcp47];
                  const checked = selected.includes(lang.bcp47);
                  return (
                    <button
                      key={lang.bcp47}
                      type="button"
                      onClick={() => toggleLanguage(lang.bcp47)}
                      disabled={translate.isPending}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                        checked
                          ? 'border-ring bg-muted/40 text-foreground'
                          : 'border-border text-muted-foreground hover:border-ring/50',
                        translate.isPending && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-4 items-center justify-center rounded border text-[10px]',
                          checked ? 'border-ring bg-primary text-primary-foreground' : 'border-border',
                        )}
                      >
                        {checked ? '✓' : ''}
                      </span>
                      {lang.label}
                      {translation && (
                        <span
                          className={cn(
                            'text-[11px] font-medium',
                            translation.status === 'READY' && 'text-emerald-400',
                            translation.status === 'GENERATING' && 'text-amber-400',
                            translation.status === 'FAILED' && 'text-destructive',
                          )}
                        >
                          {translation.status === 'READY'
                            ? 'Ready'
                            : translation.status === 'GENERATING'
                              ? 'Generating…'
                              : translation.status === 'FAILED'
                                ? 'Failed'
                                : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div>
                <Button
                  onClick={handleTranslate}
                  disabled={translate.isPending || selected.length === 0}
                >
                  {translate.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                  {translate.isPending ? 'Translating…' : 'Generate translations'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
