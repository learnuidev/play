'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import '@videojs/react/video/skin.css';
import { createPlayer, videoFeatures } from '@videojs/react';
import { VideoSkin } from '@videojs/react/video';
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video';

const Player = createPlayer({ features: videoFeatures });

export interface SubtitleTrack {
  src: string;
  srcLang: string;
  label: string;
}

export interface VideoPlayerHandle {
  seekTo: (timeMs: number) => void;
}

interface VideoPlayerProps {
  src: string;
  signedQuery: string;
  poster?: string;
  tracks?: SubtitleTrack[];
  onTimeUpdate?: (timeMs: number) => void;
  onActiveTrackChange?: (language: string | null) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    { src, signedQuery, poster, tracks = [], onTimeUpdate, onActiveTrackChange },
    ref,
  ) {
    // Appends the CloudFront path-scoped signature to every HLS request
    // (the manifest already carries it; segments are resolved relative and
    // need it re-appended).
    const config = useMemo(
      () => ({
        hlsJs: {
          xhrSetup: (xhr: XMLHttpRequest, url: string) => {
            if (!url.includes('Policy=')) {
              const separator = url.includes('?') ? '&' : '?';
              xhr.open('GET', `${url}${separator}${signedQuery}`, true);
            }
          },
        },
      }),
      [signedQuery],
    );

    const videoRef = useRef<HTMLVideoElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (timeMs: number) => {
          const video = videoRef.current;
          if (video && Number.isFinite(timeMs)) {
            video.currentTime = timeMs / 1000;
          }
        },
      }),
      [],
    );

    const onTimeUpdateRef = useRef(onTimeUpdate);
    useEffect(() => {
      onTimeUpdateRef.current = onTimeUpdate;
    }, [onTimeUpdate]);

    const onActiveTrackChangeRef = useRef(onActiveTrackChange);
    useEffect(() => {
      onActiveTrackChangeRef.current = onActiveTrackChange;
    }, [onActiveTrackChange]);

    // Report playback time so the transcript can highlight the active cue.
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handleTimeUpdate = () => {
        onTimeUpdateRef.current?.(video.currentTime * 1000);
      };

      video.addEventListener('timeupdate', handleTimeUpdate);
      return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, []);

    // The player's captions toggle shows *every* subtitle track at once when it
    // re-enables them. Enforce a single active track: keep the last explicitly
    // shown track (falling back to the first) and disable the rest.
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const textTracks = video.textTracks;
      let lastShowing: TextTrack | null = null;

      const enforceSingleSubtitle = () => {
        const subtitles: TextTrack[] = [];
        for (let i = 0; i < textTracks.length; i += 1) {
          const track = textTracks[i];
          if (track.kind === 'subtitles' || track.kind === 'captions') {
            subtitles.push(track);
          }
        }

        const showing = subtitles.filter((track) => track.mode === 'showing');

        let active: TextTrack | null = null;

        if (showing.length === 1) {
          lastShowing = showing[0];
          active = showing[0];
        } else if (showing.length > 1) {
          const keep =
            lastShowing && showing.includes(lastShowing) ? lastShowing : showing[0];
          for (const track of showing) {
            if (track !== keep) track.mode = 'disabled';
          }
          lastShowing = keep;
          active = keep;
        }

        onActiveTrackChangeRef.current?.(active?.language ?? null);
      };

      enforceSingleSubtitle();
      textTracks.addEventListener('change', enforceSingleSubtitle);

      return () => {
        textTracks.removeEventListener('change', enforceSingleSubtitle);
      };
    }, []);

    return (
      <Player.Provider>
        <VideoSkin className="player-video">
          <HlsJsVideo
            ref={videoRef}
            src={src}
            config={config}
            poster={poster}
            playsInline
            crossOrigin="anonymous"
          >
            {tracks.map((track) => (
              <track
                key={track.src}
                kind="subtitles"
                src={track.src}
                srcLang={track.srcLang}
                label={track.label}
                default={track.label === 'English'}
              />
            ))}
          </HlsJsVideo>
        </VideoSkin>
      </Player.Provider>
    );
  },
);
