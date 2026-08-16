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

export function SubtitleEditor({ videoId, initialContent, onSaved }: SubtitleEditorProps) {
  const [cues, setCues] = useState<SubtitleCue[]>(() => parseVtt(initialContent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  function updateCue(id: string, patch: Partial<Omit<SubtitleCue, 'id'>>) {
    markDirty();
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeCue(id: string) {
    markDirty();
    setCues((prev) => prev.filter((c) => c.id !== id));
  }

  function duplicateCue(id: string) {
    markDirty();
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
    markDirty();
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
    markDirty();
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
      setDirty(false);
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
        <div className="subtitle-editor-heading">
          <h3>Subtitle editor</h3>
          <span className="cue-count">{cues.length} cues</span>
          {dirty && <span className="dirty-pill">Unsaved changes</span>}
        </div>
        <div className="subtitle-editor-actions">
          <button className="btn" onClick={addCue}>
            + Add cue
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save subtitles'}
          </button>
          {saved && !dirty && <span className="desc saved-text">Saved</span>}
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div ref={parentRef} className="subtitle-editor-list">
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
                className="subtitle-cue-slot"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <div className="subtitle-cue">
                  <div className="cue-head">
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
                    <div className="cue-actions">
                      <button
                        className="cue-action"
                        onClick={() => duplicateCue(cue.id)}
                        title="Duplicate cue"
                        aria-label={`Duplicate cue ${item.index + 1}`}
                      >
                        <DuplicateIcon />
                      </button>
                      {!isLast && (
                        <button
                          className="cue-action"
                          onClick={() => mergeWithNext(cue.id)}
                          title="Merge with next cue"
                          aria-label={`Merge cue ${item.index + 1} with next`}
                        >
                          <MergeIcon />
                        </button>
                      )}
                      <button
                        className="cue-action cue-action-danger"
                        onClick={() => removeCue(cue.id)}
                        title="Delete cue"
                        aria-label={`Delete cue ${item.index + 1}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="cue-text"
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
    </div>
  );
}
