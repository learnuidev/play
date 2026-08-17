"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface AudioPlayerHandle {
  seekTo: (timeMs: number) => void;
}

interface AudioPlayerProps {
  src: string;
  onTimeUpdate?: (timeMs: number) => void;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ src, onTimeUpdate }, ref) {
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
