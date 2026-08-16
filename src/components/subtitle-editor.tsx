'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSaveSubtitles } from '@/modules/subtitle/subtitle.queries';
import { formatTimestamp, parseTimestamp, parseVtt, serializeVtt } from '@/lib/vtt';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SubtitleCue, SubtitleResponse } from '@/types';

interface SubtitleEditorProps {
  videoId: string;
  subtitle: SubtitleResponse;
}

let cueCounter = 0;
function nextId(): string {
  cueCounter += 1;
  return `cue-${Date.now().toString(36)}-${cueCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function DuplicateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5v5A1.5 1.5 0 0 0 3.5 10H5.5" />
    </svg>
  );
}

function MergeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5v8M4.5 8L8 11.5 11.5 8" />
      <path d="M2.5 14.5h11" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h11" />
      <path d="M6.5 4V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V4" />
      <path d="M5 4l.5 9a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9L11 4" />
    </svg>
  );
}

export function SubtitleEditor({ videoId, subtitle }: SubtitleEditorProps) {
  const languages = useMemo(() => {
    const available = subtitle.languages ?? [];
    if (available.length) return available;
    return [
      {
        language: subtitle.sourceLanguage,
        label: subtitle.sourceLanguage.toLowerCase().startsWith('en') ? 'English' : subtitle.sourceLanguage,
        isSource: true,
        content: subtitle.content,
      },
    ];
  }, [subtitle.languages, subtitle.sourceLanguage, subtitle.content]);

  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    languages[0]?.language ?? subtitle.sourceLanguage,
  );
  const [cuesByLanguage, setCuesByLanguage] = useState<Record<string, SubtitleCue[]>>(() => {
    const map: Record<string, SubtitleCue[]> = {};
    for (const lang of languages) map[lang.language] = parseVtt(lang.content);
    return map;
  });
  const [dirtyLangs, setDirtyLangs] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'cues' | 'raw'>('cues');
  const [rawByLanguage, setRawByLanguage] = useState<Record<string, string>>({});
  const parentRef = useRef<HTMLDivElement>(null);
  const justAddedRef = useRef(false);
  const save = useSaveSubtitles(videoId);

  const cues = cuesByLanguage[selectedLanguage] ?? [];
  const dirty = Boolean(dirtyLangs[selectedLanguage]);
  const selectedTrack = languages.find((l) => l.language === selectedLanguage);
  const isSource = selectedTrack?.isSource ?? true;
  const rawText = rawByLanguage[selectedLanguage] ?? serializeVtt(cues);

  // Pick up language tracks that appear after a refetch (e.g. freshly
  // generated translations) without clobbering in-progress edits.
  useEffect(() => {
    setCuesByLanguage((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const lang of languages) {
        if (!next[lang.language]) {
          next[lang.language] = parseVtt(lang.content);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [languages]);

  // Reset the selection if the current language is no longer available.
  useEffect(() => {
    if (!languages.some((l) => l.language === selectedLanguage)) {
      setSelectedLanguage(languages[0]?.language ?? subtitle.sourceLanguage);
    }
  }, [languages, selectedLanguage, subtitle.sourceLanguage]);

  const virtualizer = useVirtualizer({
    count: cues.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 112,
    overscan: 10,
  });

  useEffect(() => {
    if (justAddedRef.current && cues.length > 0) {
      justAddedRef.current = false;
      virtualizer.scrollToIndex(cues.length - 1, { align: 'end' });
    }
  }, [cues.length, virtualizer]);

  function markDirty() {
    setDirtyLangs((prev) => ({ ...prev, [selectedLanguage]: true }));
  }

  function switchView(next: 'cues' | 'raw') {
    if (next === view) return;
    if (next === 'raw') {
      setRawByLanguage((prev) =>
        prev[selectedLanguage] !== undefined
          ? prev
          : { ...prev, [selectedLanguage]: serializeVtt(cues) },
      );
    } else {
      const draft = rawByLanguage[selectedLanguage];
      if (draft !== undefined) {
        setCuesByLanguage((prev) => ({
          ...prev,
          [selectedLanguage]: parseVtt(draft),
        }));
      }
    }
    setView(next);
  }

  function handleLanguageChange(nextLang: string) {
    if (view === 'raw') {
      const draft = rawByLanguage[selectedLanguage];
      if (draft !== undefined) {
        setCuesByLanguage((prev) => ({
          ...prev,
          [selectedLanguage]: parseVtt(draft),
        }));
      }
    }
    setSelectedLanguage(nextLang);
  }

  function setCues(updater: (prev: SubtitleCue[]) => SubtitleCue[]) {
    markDirty();
    setCuesByLanguage((prev) => ({
      ...prev,
      [selectedLanguage]: updater(prev[selectedLanguage] ?? []),
    }));
  }

  function updateCue(id: string, patch: Partial<Omit<SubtitleCue, 'id'>>) {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeCue(id: string) {
    setCues((prev) => prev.filter((c) => c.id !== id));
  }

  function duplicateCue(id: string) {
    setCues((prev) => {
      const index = prev.findIndex((c) => c.id === id);
      if (index === -1) return prev;
      const copy: SubtitleCue = { ...prev[index], id: nextId() };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function mergeWithNext(id: string) {
    setCues((prev) => {
      const index = prev.findIndex((c) => c.id === id);
      if (index === -1 || index >= prev.length - 1) return prev;
      const first = prev[index];
      const second = prev[index + 1];
      const merged: SubtitleCue = {
        id: nextId(),
        start: first.start,
        end: second.end,
        text: [first.text.trim(), second.text.trim()].filter(Boolean).join(' '),
      };
      const next = [...prev];
      next.splice(index, 2, merged);
      return next;
    });
  }

  function addCue() {
    justAddedRef.current = true;
    setCues((prev) => {
      let start = '00:00:00.000';
      const last = prev[prev.length - 1];
      if (last) {
        const lastEnd = parseTimestamp(last.end);
        if (lastEnd !== null) start = formatTimestamp(lastEnd);
      }
      const endMs = (parseTimestamp(start) ?? 0) + 2000;
      return [...prev, { id: nextId(), start, end: formatTimestamp(endMs), text: '' }];
    });
  }

  function validateCues(list: SubtitleCue[]): string | null {
    for (let i = 0; i < list.length; i++) {
      const cue = list[i];
      const start = parseTimestamp(cue.start);
      const end = parseTimestamp(cue.end);
      if (start === null) return `Cue ${i + 1}: invalid start time "${cue.start}"`;
      if (end === null) return `Cue ${i + 1}: invalid end time "${cue.end}"`;
      if (start >= end) return `Cue ${i + 1}: start time must be before end time`;
      if (!cue.text.trim()) return `Cue ${i + 1}: text is empty`;
    }
    return null;
  }

  function handleSave() {
    setError(null);

    const label = selectedTrack?.label ?? selectedLanguage;
    const onSuccess = () => {
      setDirtyLangs((prev) => ({ ...prev, [selectedLanguage]: false }));
      toast.success(`Subtitle for ${label} saved successfully`);
    };
    const onError = (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to save subtitles');
    };

    if (view === 'raw') {
      if (!rawText.trim()) {
        setError('Subtitle text is empty');
        return;
      }

      const parsed = parseVtt(rawText);
      if (parsed.length === 0) {
        setError('No valid cues found in the raw subtitle text');
        return;
      }

      const invalid = validateCues(parsed);
      if (invalid) {
        setError(invalid);
        return;
      }

      setCuesByLanguage((prev) => ({ ...prev, [selectedLanguage]: parsed }));
      save.mutate(
        { content: rawText, language: isSource ? undefined : selectedLanguage },
        { onSuccess, onError },
      );
      return;
    }

    const invalid = validateCues(cues);
    if (invalid) {
      setError(invalid);
      return;
    }

    save.mutate(
      { content: serializeVtt(cues), language: isSource ? undefined : selectedLanguage },
      { onSuccess, onError },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <select
            value={selectedLanguage}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50"
            aria-label="Subtitle language"
          >
            {languages.map((lang) => (
              <option key={lang.language} value={lang.language}>
                {lang.label}
              </option>
            ))}
          </select>
          <h3 className="text-sm font-semibold">Subtitle editor</h3>
          <Tabs value={view} onValueChange={(v) => switchView(v as 'cues' | 'raw')}>
            <TabsList className="h-8">
              <TabsTrigger value="cues" className="h-6 px-2.5 text-xs">
                Editor
              </TabsTrigger>
              <TabsTrigger value="raw" className="h-6 px-2.5 text-xs">
                Raw
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
            {cues.length} cues
          </span>
          {dirty && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-400">
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {view === 'cues' && (
            <Button variant="outline" size="sm" onClick={addCue}>
              + Add cue
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save subtitles'}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {view === 'cues' ? (
      <div ref={parentRef} className="h-[55vh] overflow-y-auto rounded-xl border bg-background p-2.5">
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const cue = cues[item.index];
            if (!cue) return null;
            const isLast = item.index === cues.length - 1;
            return (
              <div
                key={cue.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="pb-2.5"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <div className="rounded-xl border bg-card p-3 transition-colors hover:border-ring/40">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                      {item.index + 1}
                    </span>
                    <input
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs tabular-nums outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50"
                      value={cue.start}
                      onChange={(e) => updateCue(cue.id, { start: e.target.value })}
                      aria-label={`Cue ${item.index + 1} start time`}
                    />
                    <span className="shrink-0 text-muted-foreground">→</span>
                    <input
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs tabular-nums outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50"
                      value={cue.end}
                      onChange={(e) => updateCue(cue.id, { end: e.target.value })}
                      aria-label={`Cue ${item.index + 1} end time`}
                    />
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => duplicateCue(cue.id)}
                        title="Duplicate cue"
                        aria-label={`Duplicate cue ${item.index + 1}`}
                      >
                        <DuplicateIcon />
                      </button>
                      {!isLast && (
                        <button
                          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => mergeWithNext(cue.id)}
                          title="Merge with next cue"
                          aria-label={`Merge cue ${item.index + 1} with next`}
                        >
                          <MergeIcon />
                        </button>
                      )}
                      <button
                        className={cn(
                          'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                          'hover:bg-destructive/10 hover:text-destructive',
                        )}
                        onClick={() => removeCue(cue.id)}
                        title="Delete cue"
                        aria-label={`Delete cue ${item.index + 1}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="mt-2 block w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm leading-relaxed outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50"
                    value={cue.text}
                    onChange={(e) => updateCue(cue.id, { text: e.target.value })}
                    rows={Math.min(6, Math.max(1, cue.text.split('\n').length))}
                    aria-label={`Cue ${item.index + 1} text`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      ) : (
        <textarea
          value={rawText}
          onChange={(e) => {
            setRawByLanguage((prev) => ({ ...prev, [selectedLanguage]: e.target.value }));
            markDirty();
          }}
          className="h-[55vh] w-full resize-y rounded-xl border bg-background p-3 font-mono text-xs leading-relaxed outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50"
          aria-label="Raw subtitle text"
        />
      )}
    </div>
  );
}
