export type VideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export const VIDEO_STATUSES: VideoStatus[] = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'];

export interface Video {
  videoId: string;
  ownerId: string;
  title: string;
  description: string;
  status: VideoStatus;
  fileName: string;
  contentType: string;
  size: number;
  /** Raw upload key: uploads/{videoId}/{fileName} */
  s3Key: string;
  /** Processed HLS master playlist key: processed/{videoId}/hls/... */
  manifestKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StreamInfo {
  manifestUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}
