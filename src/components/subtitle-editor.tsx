'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatTimestamp, parseTimestamp, parseVtt, serializeVtt } from '@/lib/vtt';
import type { SubtitleCue } from '@/types';

interface SubtitleEditorProps {
  videoId: string;
  initialContent: string;
  onSaved: () => void;
}

let cueCounter = 0;
function nextId(): string {
  cueCounter += 1;
  return `cue-${Date.now().toString(36)}-${cueCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SubtitleEditor({ videoId, initialContent, onSaved }: SubtitleEditorProps) {
  const [cues, setCues] = useState<SubtitleCue[]>(() => parseVtt(initialContent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const justAddedRef = useRef(false);

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

  function updateCue(id: string, patch: Partial<Omit<SubtitleCue, 'id'>>) {
    setSaved(false);
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeCue(id: string) {
    setSaved(false);
    setCues((prev) => prev.filter((c) => c.id !== id));
  }

  function addCue() {
    setSaved(false);
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

  function validate(): string | null {
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const start = parseTimestamp(cue.start);
      const end = parseTimestamp(cue.end);
      if (start === null) return `Cue ${i + 1}: invalid start time "${cue.start}"`;
      if (end === null) return `Cue ${i + 1}: invalid end time "${cue.end}"`;
      if (start >= end) return `Cue ${i + 1}: start time must be before end time`;
      if (!cue.text.trim()) return `Cue ${i + 1}: text is empty`;
    }
    return null;
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }

    setSaving(true);
    try {
      await api.saveSubtitles(videoId, serializeVtt(cues));
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save subtitles');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="subtitle-editor">
      <div className="subtitle-editor-toolbar">
        <h3>Subtitle editor</h3>
        <span className="desc">{cues.length} cues</span>
        <button className="btn" onClick={addCue}>
          Add cue
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save subtitles'}
        </button>
        {saved && <span className="desc saved-text">Saved</span>}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div ref={parentRef} className="subtitle-editor-list">
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const cue = cues[item.index];
            if (!cue) return null;
            return (
              <div
                key={cue.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="subtitle-cue"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <span className="cue-index">{item.index + 1}</span>
                <input
                  className="cue-time"
                  value={cue.start}
                  onChange={(e) => updateCue(cue.id, { start: e.target.value })}
                  aria-label={`Cue ${item.index + 1} start time`}
                />
                <span className="cue-arrow">→</span>
                <input
                  className="cue-time"
                  value={cue.end}
                  onChange={(e) => updateCue(cue.id, { end: e.target.value })}
                  aria-label={`Cue ${item.index + 1} end time`}
                />
                <button
                  className="cue-delete"
                  onClick={() => removeCue(cue.id)}
                  title="Delete cue"
                  aria-label={`Delete cue ${item.index + 1}`}
                >
                  ×
                </button>
                <textarea
                  className="cue-text"
                  value={cue.text}
                  onChange={(e) => updateCue(cue.id, { text: e.target.value })}
                  rows={Math.min(6, Math.max(1, cue.text.split('\n').length))}
                  aria-label={`Cue ${item.index + 1} text`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
