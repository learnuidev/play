'use client';

import { useMemo } from 'react';
import '@videojs/react/video/skin.css';
import { createPlayer, videoFeatures } from '@videojs/react';
import { VideoSkin } from '@videojs/react/video';
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video';

const Player = createPlayer({ features: videoFeatures });

interface VideoPlayerProps {
  src: string;
  signedQuery: string;
}

export function VideoPlayer({ src, signedQuery }: VideoPlayerProps) {
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

  return (
    <Player.Provider>
      <VideoSkin className="player-video">
        <HlsJsVideo src={src} config={config} playsInline />
      </VideoSkin>
    </Player.Provider>
  );
}
