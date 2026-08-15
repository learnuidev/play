'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { CreateVideoResponse } from '@/types';

interface VideoUploaderProps {
  onUploaded: (result: CreateVideoResponse) => void;
}

type UploadState = 'idle' | 'starting' | 'uploading' | 'done';

export function VideoUploader({ onUploaded }: VideoUploaderProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    setError(null);

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a video file to upload');
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    try {
      setState('starting');
      const created = await api.createVideo({
        title: title.trim(),
        description: description.trim(),
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      });

      setState('uploading');

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(created.upload.method, created.upload.url);
        Object.entries(created.upload.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file);
      });

      setState('done');
      setProgress(100);
      setTitle('');
      setDescription('');
      if (fileRef.current) fileRef.current.value = '';
      onUploaded(created);
    } catch (err) {
      setState('idle');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  return (
    <div className="upload-form">
      <div className="form-row">
        <label htmlFor="video-file">Video file</label>
        <input
          id="video-file"
          ref={fileRef}
          type="file"
          accept="video/*"
          onChange={(e) => {
            const name = e.target.files?.[0]?.name;
            if (name) setTitle(name.replace(/\.[^.]+$/, ''));
          }}
        />
      </div>
      <div className="form-row">
        <label htmlFor="video-title">Title</label>
        <input
          id="video-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My awesome video"
        />
      </div>
      <div className="form-row">
        <label htmlFor="video-desc">Description</label>
        <input
          id="video-desc"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
        />
      </div>

      {state === 'uploading' && (
        <div className="form-row">
          <span className="desc">Uploading… {progress}%</span>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      <button
        className="btn btn-primary"
        onClick={handleUpload}
        disabled={state === 'starting' || state === 'uploading'}
      >
        {state === 'starting' ? 'Preparing…' : state === 'uploading' ? 'Uploading…' : 'Upload video'}
      </button>
    </div>
  );
}
