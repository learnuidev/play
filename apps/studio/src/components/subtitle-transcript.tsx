"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import { parseTimestamp } from "@learning/lib/vtt";
import { cn } from "@ui/lib/utils";
import { Input } from "@ui/components/ui/input";
import type { SubtitleCue } from "@play/types";

interface SubtitleTranscriptProps {
  cues: SubtitleCue[];
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerQuery);
  let key = 0;

  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <mark key={key++} className="rounded-sm bg-yellow-400/30 text-foreground">
        {text.slice(index, index + query.length)}
      </mark>,
    );
    cursor = index + query.length;
    index = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function SubtitleTranscript({
  cues,
  currentTimeMs,
  onSeek,
}: SubtitleTranscriptProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();

  const filtered = useMemo(() => {
    if (!normalizedQuery) return cues;
    const q = normalizedQuery.toLowerCase();
    return cues.filter((cue) =>
      normalizeText(cue.text).toLowerCase().includes(q),
    );
  }, [cues, normalizedQuery]);

  const activeId = useMemo(() => {
    for (const cue of cues) {
      const start = parseTimestamp(cue.start);
      const end = parseTimestamp(cue.end);
      if (start === null || end === null) continue;
      if (currentTimeMs >= start && currentTimeMs < end) return cue.id;
    }
    return null;
  }, [cues, currentTimeMs]);

  return (
    <div className="mt-3">
      <div className="relative w-full max-w-xs">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search subtitles"
          className="pl-9"
          aria-label="Search subtitles"
        />
      </div>

      <div className="mt-3 rounded-xl border bg-card p-4 leading-relaxed text-muted-foreground">
        {filtered.length === 0 ? (
          <p>
            {normalizedQuery
              ? "No matching subtitles."
              : "No subtitles available for this language."}
          </p>
        ) : (
          <p>
            {filtered.map((cue) => {
              const startMs = parseTimestamp(cue.start);
              const text = normalizeText(cue.text);
              return (
                <Fragment key={cue.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (startMs !== null) onSeek(startMs);
                    }}
                    className={cn(
                      "rounded px-0.5 py-0.5 text-left transition-colors hover:bg-primary/10 hover:text-foreground",
                      activeId === cue.id && "bg-primary/15 text-foreground",
                    )}
                  >
                    <HighlightedText text={text} query={normalizedQuery} />
                  </button>{" "}
                </Fragment>
              );
            })}
          </p>
        )}
      </div>
    </div>
  );
}
