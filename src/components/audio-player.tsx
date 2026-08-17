"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface AudioPlayerHandle {
  seekTo: (timeMs: number) => void;
}

interface AudioPlayerProps {
  src: string;
  /** Position (ms) to start playback from on mount. */
  initialTimeMs?: number;
  /** Resume playing automatically on mount (used when switching formats). */
  autoPlay?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (timeMs: number) => void;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ src, initialTimeMs, autoPlay, onPlay, onPause, onTimeUpdate }, ref) {
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (timeMs: number) => {
          const audio = audioRef.current;
          if (audio && Number.isFinite(timeMs)) {
            audio.currentTime = timeMs / 1000;
          }
        },
      }),
      [],
    );

    const onTimeUpdateRef = useRef(onTimeUpdate);
    useEffect(() => {
      onTimeUpdateRef.current = onTimeUpdate;
    }, [onTimeUpdate]);

    const onPlayRef = useRef(onPlay);
    useEffect(() => {
      onPlayRef.current = onPlay;
    }, [onPlay]);

    const onPauseRef = useRef(onPause);
    useEffect(() => {
      onPauseRef.current = onPause;
    }, [onPause]);

    // Report play/pause so the parent can carry the state across format switches.
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const handlePlay = () => onPlayRef.current?.();
      const handlePause = () => onPauseRef.current?.();

      audio.addEventListener("play", handlePlay);
      audio.addEventListener("pause", handlePause);
      return () => {
        audio.removeEventListener("play", handlePlay);
        audio.removeEventListener("pause", handlePause);
      };
    }, []);

    // Resume from the requested position and, if requested, keep playing.
    // Captured at mount so subsequent prop changes don't re-seek playback.
    const initialTimeMsRef = useRef(initialTimeMs);
    const autoPlayRef = useRef(autoPlay);
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const resume = () => {
        const start = initialTimeMsRef.current;
        if (start && audio.readyState >= 1) audio.currentTime = start / 1000;
        if (autoPlayRef.current) {
          const p = audio.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      };

      if (audio.readyState >= 1) {
        resume();
      } else {
        audio.addEventListener("loadedmetadata", resume, { once: true });
      }
      return () => audio.removeEventListener("loadedmetadata", resume);
    }, []);

    // Report playback time so the transcript can highlight the active cue.
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const handleTimeUpdate = () => {
        onTimeUpdateRef.current?.(audio.currentTime * 1000);
      };

      audio.addEventListener("timeupdate", handleTimeUpdate);
      return () => audio.removeEventListener("timeupdate", handleTimeUpdate);
    }, []);

    return (
      <audio
        ref={audioRef}
        src={src}
        controls
        preload="metadata"
        className="w-full"
      />
    );
  },
);
