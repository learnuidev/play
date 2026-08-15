'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';
import { useState } from 'react';
import { VideoList } from '@/components/video-list';
import { VideoUploader } from '@/components/video-uploader';
import type { VideoStatus } from '@/types';

const FILTERS: Array<VideoStatus | 'ALL'> = ['ALL', 'UPLOADING', 'PROCESSING', 'READY', 'FAILED'];

export default function Home() {
  const { user, signOut } = useAuthenticator((context) => [context.user]);
  const [filter, setFilter] = useState<VideoStatus | 'ALL'>('ALL');
  const [uploadTick, setUploadTick] = useState(0);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Play</h1>
        <div className="user-meta">
          <span>{user?.signInDetails?.loginId ?? user?.username}</span>
          <button className="btn" onClick={signOut}>
            Log out
          </button>
        </div>
      </header>

      <VideoUploader onUploaded={() => setUploadTick((t) => t + 1)} />

      <div className="filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`filter-chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <VideoList key={`${filter}-${uploadTick}`} status={filter} />
    </div>
  );
}
