export interface PresignedUpload {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * PUTs a file straight to S3 with a presigned URL.
 *
 * `fetch` cannot report upload progress, and these uploads can be tens of
 * megabytes, so this uses `XMLHttpRequest` — the one browser API that can.
 * Resolves once S3 has accepted the object.
 */
export function putFileToPresignedUrl(
  file: File | Blob,
  upload: PresignedUpload,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    Object.entries(upload.headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }

    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}
