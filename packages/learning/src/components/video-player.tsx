"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import "@videojs/react/video/skin.css";
import { createPlayer, videoFeatures } from "@videojs/react";
import { VideoSkin } from "@videojs/react/video";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import {
  captionCharsPerLine,
  cueLineCount,
  cueLinePercent,
  wrapCueText,
} from "@learning/lib/vtt";

const Player = createPlayer({ features: videoFeatures });

export interface SubtitleTrack {
  src: string;
  srcLang: string;
  label: string;
}

export interface VideoPlayerHandle {
  seekTo: (timeMs: number) => void;
  /**
   * Starts playback.
   *
   * Seeking is not playing: a player that has been paused and put somewhere else
   * is still paused. Anything that auditions a stretch of the video — the loop
   * picker — has to ask for both.
   */
  play: () => void;
  /**
   * Where playback is, in milliseconds, read straight off the media element.
   *
   * `onTimeUpdate` is not enough to animate against: the element reports its
   * position about four times a second, which is plenty to know where playback
   * is and far too little to move a fill front with. Anything animating word by
   * word reads this once a frame instead.
   */
  getTimeMs: () => number;
  /**
   * How long the video runs, in milliseconds, or 0 until the stream's metadata
   * has arrived. Anything asking "is this nearly over?" needs both ends of it.
   */
  getDurationMs: () => number;
}

interface VideoPlayerProps {
  src: string;
  signedQuery: string;
  poster?: string;
  tracks?: SubtitleTrack[];
  /** Position (ms) to start playback from on mount. */
  initialTimeMs?: number;
  /** Resume playing automatically on mount (used when switching formats). */
  autoPlay?: boolean;
  /** BCP-47 language of the subtitle track to enable on mount. */
  initialTrackLanguage?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (timeMs: number) => void;
  onActiveTrackChange?: (language: string | null) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    {
      src,
      signedQuery,
      poster,
      tracks = [],
      initialTimeMs,
      autoPlay,
      initialTrackLanguage,
      onPlay,
      onPause,
      onTimeUpdate,
      onActiveTrackChange,
    },
    ref,
  ) {
    // Appends the CloudFront path-scoped signature to every HLS request
    // (the manifest already carries it; segments are resolved relative and
    // need it re-appended).
    const config = useMemo(
      () => ({
        hlsJs: {
          xhrSetup: (xhr: XMLHttpRequest, url: string) => {
            if (!url.includes("Policy=")) {
              const separator = url.includes("?") ? "&" : "?";
              xhr.open("GET", `${url}${separator}${signedQuery}`, true);
            }
          },
        },
      }),
      [signedQuery],
    );

    const videoRef = useRef<HTMLVideoElement | null>(null);

    /**
     * A position asked for before the stream could take it.
     *
     * Assigning `currentTime` to an element that has no metadata yet is not a
     * seek: there is no duration to seek within, and the browser drops it. So a
     * tap on the transcript a moment after the lesson opened did nothing at all.
     * The position is held here instead and applied the moment the stream has
     * something to seek in.
     */
    const pendingSeekRef = useRef<number | null>(null);

    /**
     * Starts playback, and keeps the sound if the browser will not hand it over.
     *
     * A page that starts itself is precisely what an autoplay policy exists to
     * refuse, and whether a lesson opened from a link may begin unmuted is the
     * browser's decision and not ours. Refused, the video starts muted instead:
     * a lesson playing quietly is one whose volume can be turned up, while one
     * that never started is one that has to be pressed. The sound then comes
     * back at the first thing the reader touches, which is a gesture the browser
     * does accept — and both listeners are removed by whichever of them fires
     * first, so neither is left behind for the next click to trip over.
     */
    const startPlayback = useCallback((video: HTMLVideoElement) => {
      const started = video.play();
      if (!started || typeof started.catch !== 'function') return;

      started.catch(() => {
        video.muted = true;

        const quiet = video.play();
        if (quiet && typeof quiet.catch === 'function') quiet.catch(() => {});

        const restore = () => {
          video.muted = false;
          document.removeEventListener('pointerdown', restore);
          document.removeEventListener('keydown', restore);
        };

        document.addEventListener('pointerdown', restore);
        document.addEventListener('keydown', restore);
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (timeMs: number) => {
          const video = videoRef.current;
          if (!video || !Number.isFinite(timeMs)) return;

          if (video.readyState < 1) {
            pendingSeekRef.current = timeMs;
            return;
          }

          video.currentTime = timeMs / 1000;
        },
        getTimeMs: () => {
          const video = videoRef.current;
          // Reading `currentTime` is a media property, not a layout one: it does
          // not force a style flush, so once a frame is cheap.
          return video && Number.isFinite(video.currentTime) ? video.currentTime * 1000 : 0;
        },
        play: () => {
          const video = videoRef.current;
          if (video) startPlayback(video);
        },
        getDurationMs: () => {
          const video = videoRef.current;
          return video && Number.isFinite(video.duration) ? video.duration * 1000 : 0;
        },
      }),
      [startPlayback],
    );

    const onTimeUpdateRef = useRef(onTimeUpdate);
    useEffect(() => {
      onTimeUpdateRef.current = onTimeUpdate;
    }, [onTimeUpdate]);

    const onActiveTrackChangeRef = useRef(onActiveTrackChange);
    useEffect(() => {
      onActiveTrackChangeRef.current = onActiveTrackChange;
    }, [onActiveTrackChange]);

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
      const video = videoRef.current;
      if (!video) return;

      const handlePlay = () => onPlayRef.current?.();
      const handlePause = () => onPauseRef.current?.();

      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      return () => {
        video.removeEventListener("play", handlePlay);
        video.removeEventListener("pause", handlePause);
      };
    }, []);

    // Resume from the requested position and, if requested, keep playing.
    // Captured at mount so subsequent prop changes (e.g. the transcript time)
    // don't re-seek playback.
    const initialTimeMsRef = useRef(initialTimeMs);
    const autoPlayRef = useRef(autoPlay);
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const resume = () => {
        const start = initialTimeMsRef.current;
        if (start && video.readyState >= 1) video.currentTime = start / 1000;
        if (autoPlayRef.current) startPlayback(video);
      };

      if (video.readyState >= 1) {
        resume();
      } else {
        video.addEventListener("loadedmetadata", resume, { once: true });
      }
      return () => video.removeEventListener("loadedmetadata", resume);
    }, [startPlayback]);

    // The seek that arrived before the stream was ready, applied as soon as it
    // can be. Declared after the resume above, so a position named by hand wins
    // over the one the lesson was opened at.
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const flush = () => {
        const pending = pendingSeekRef.current;
        if (pending === null || video.readyState < 1) return;
        pendingSeekRef.current = null;
        video.currentTime = pending / 1000;
      };

      flush();
      video.addEventListener("loadedmetadata", flush);
      return () => video.removeEventListener("loadedmetadata", flush);
    }, []);

    // Report playback time so the transcript can highlight the active cue.
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handleTimeUpdate = () => {
        onTimeUpdateRef.current?.(video.currentTime * 1000);
      };

      video.addEventListener("timeupdate", handleTimeUpdate);
      return () => video.removeEventListener("timeupdate", handleTimeUpdate);
    }, []);

    // The player's captions toggle shows *every* subtitle track at once when it
    // re-enables them. Enforce a single active track: keep the last explicitly
    // shown track (falling back to the first) and disable the rest.
    // Also re-applies the previously selected track on mount so switching
    // formats (which remounts the player) keeps the chosen subtitle language.
    const initialTrackLanguageRef = useRef(initialTrackLanguage);
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const textTracks = video.textTracks;
      let lastShowing: TextTrack | null = null;

      const collectSubtitles = () => {
        const subtitles: TextTrack[] = [];
        for (let i = 0; i < textTracks.length; i += 1) {
          const track = textTracks[i];
          if (track.kind === "subtitles" || track.kind === "captions") {
            subtitles.push(track);
          }
        }
        return subtitles;
      };

      const applyInitialTrack = () => {
        const target = initialTrackLanguageRef.current;
        if (!target) return;
        const subtitles = collectSubtitles();
        const match = subtitles.find(
          (track) => track.language.toLowerCase() === target.toLowerCase(),
        );
        if (match) {
          for (const track of subtitles) {
            if (track !== match) track.mode = "disabled";
          }
          if (match.mode !== "showing") match.mode = "showing";
          lastShowing = match;
        }
      };

      const enforceSingleSubtitle = () => {
        const subtitles = collectSubtitles();
        const showing = subtitles.filter((track) => track.mode === "showing");

        let active: TextTrack | null = null;

        if (showing.length === 1) {
          lastShowing = showing[0];
          active = showing[0];
        } else if (showing.length > 1) {
          const keep =
            lastShowing && showing.includes(lastShowing)
              ? lastShowing
              : showing[0];
          for (const track of showing) {
            if (track !== keep) track.mode = "disabled";
          }
          lastShowing = keep;
          active = keep;
        }

        onActiveTrackChangeRef.current?.(active?.language ?? null);
      };

      applyInitialTrack();
      enforceSingleSubtitle();
      textTracks.addEventListener("change", enforceSingleSubtitle);
      textTracks.addEventListener("addtrack", applyInitialTrack);

      return () => {
        textTracks.removeEventListener("change", enforceSingleSubtitle);
        textTracks.removeEventListener("addtrack", applyInitialTrack);
      };
    }, []);

    // A cue's `line` percentage positions the box by its *top* edge and the box
    // grows downward, so a caption that wrapped onto a second (or third) line
    // ran past the bottom of the frame and got cut off — the longer the cue, the
    // more of it was lost. Chrome also ignores the `end` line alignment, so the
    // box cannot just be bottom-anchored.
    //
    // Instead: wrap the text onto as many lines as it needs (up to what fits at
    // this video size) and lift the anchor by one line per extra line, which
    // keeps the block's bottom edge where a single line would have been. Doing
    // it here also fixes subtitle files generated before the writers knew about
    // wrapping, and adapts to the size/aspect of the video being played.
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const laidOut: TextTrack[] = [];

      const layoutCues = (track: TextTrack) => {
        const cues = track.cues;
        if (!cues) return;
        if (!laidOut.includes(track)) laidOut.push(track);

        const maxChars = captionCharsPerLine(video.videoWidth, video.videoHeight);
        for (let i = 0; i < cues.length; i += 1) {
          const cue = cues[i] as VTTCue;
          try {
            const text = wrapCueText(cue.text, maxChars);
            cue.snapToLines = false;
            cue.line = cueLinePercent(cueLineCount(text));
            if (text !== cue.text) cue.text = text;
          } catch {
            // Some browsers expose cue settings as read-only; the cue settings
            // written into the VTT file still apply.
          }
        }
      };

      // Re-lays out with the real video dimensions, in case a track finished
      // loading before the media metadata (and so its aspect ratio) was known.
      const relayout = () => {
        for (let i = 0; i < laidOut.length; i += 1) layoutCues(laidOut[i]);
      };

      const attached = new WeakSet<HTMLTrackElement>();
      const attachTrackElements = () => {
        const elements = video.querySelectorAll("track");
        for (let i = 0; i < elements.length; i += 1) {
          const element = elements[i];
          if (attached.has(element)) continue;
          attached.add(element);
          element.addEventListener("load", () => layoutCues(element.track));
          layoutCues(element.track); // already loaded, e.g. the default track
        }
      };

      // Tracks rendered after mount are picked up by the `addtrack` listener
      // below, so this effect never needs to re-run (and re-attach listeners).
      attachTrackElements();
      video.addEventListener("loadedmetadata", relayout);
      const textTracks = video.textTracks;
      textTracks.addEventListener("addtrack", attachTrackElements);
      return () => {
        video.removeEventListener("loadedmetadata", relayout);
        textTracks.removeEventListener("addtrack", attachTrackElements);
      };
    }, []);

    return (
      <Player.Provider>
        {/* The skin fills its parent (width/height: 100%), so without an
            explicit aspect ratio it collapses to the video element's default
            150px until the stream's metadata arrives — the box then jumps to
            16:9 and shoves the page below it. Pinning 16:9 keeps the player the
            same size as the placeholder it replaces, before and after loading. */}
        <VideoSkin className="player-video aspect-video">
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
                default={track.label === "English"}
              />
            ))}
          </HlsJsVideo>
        </VideoSkin>
      </Player.Provider>
    );
  },
);
