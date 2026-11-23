import { useState } from "hono/jsx";

interface FileUploadOptions {
  maxConcurrentFiles?: number;
  maxConcurrentChunks?: number;
  chunkSize?: number;
  maxRetries?: number;
}

interface UploadProgress {
  progress: number;
  fileId: string;
}

interface FileWithThumbnail {
  name: string;
  file: File;
  type: string;
  size: number;
  thumbnail?: string | null;
  icon?: string;
}

/** Errors the server reports as final (4xx) – retrying won't help */
class FatalUploadError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs tasks with a fixed concurrency (a pool instead of fixed batches) */
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  let failed: unknown = null;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !failed) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (e) {
        failed = e;
      }
    }
  });
  await Promise.all(runners);
  if (failed) throw failed;
}

export const useFileUpload = (code: string, options: FileUploadOptions = {}) => {
  const {
    // Files are held in the Durable Object's RAM – keep the number/size of
    // in-flight chunks small (max ~4 × 2 MB being parsed on the server at once).
    maxConcurrentFiles = 1,
    maxConcurrentChunks = 4,
    chunkSize = 2 * 1024 * 1024,
    maxRetries = 4,
  } = options;

  const [uploadProgress, setUploadProgress] = useState<Map<string, UploadProgress>>(new Map());

  const processFiles = async (
    files: FileWithThumbnail[],
    onProgress?: (name: string, progress: number) => void
  ) => {
    const progressMap = new Map<string, UploadProgress>();
    let lastRender = 0;
    const report = (name: string, progress: number, fileId: string, force = false) => {
      progressMap.set(name, { progress, fileId });
      // Throttle re-renders – many chunks finishing at once caused UI jank
      const now = performance.now();
      if (force || now - lastRender > 150) {
        lastRender = now;
        setUploadProgress(new Map(progressMap));
      }
      onProgress?.(name, progress);
    };

    await runPool(files, maxConcurrentFiles, async (fileData) => {
      const fileId = crypto.randomUUID();
      report(fileData.name, 0, fileId, true);
      await uploadInChunks(fileData, fileId, (p) => report(fileData.name, p, fileId, p >= 100));
    });
    setUploadProgress(new Map(progressMap));
  };

  const uploadChunk = async (
    fileData: FileWithThumbnail,
    fileId: string,
    index: number,
    totalChunks: number,
    fileInfo: string
  ) => {
    const start = index * chunkSize;
    const blob = fileData.file.slice(start, Math.min(start + chunkSize, fileData.file.size));

    for (let attempt = 0; ; attempt++) {
      const formData = new FormData();
      formData.append("chunk", blob, "chunk");
      formData.append("fileId", fileId);
      formData.append("index", String(index));
      formData.append("totalChunks", String(totalChunks));
      formData.append("fileInfo", fileInfo);

      try {
        const response = await fetch(`/${code}/upload-chunk`, {
          method: "POST",
          body: formData,
        });
        if (response.ok) return;

        let message = response.statusText;
        try {
          message = ((await response.json()) as { error?: string }).error || message;
        } catch {
          /* not JSON */
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          throw new FatalUploadError(message || `HTTP ${response.status}`);
        }
        throw new Error(message || `HTTP ${response.status}`);
      } catch (error) {
        if (error instanceof FatalUploadError || attempt >= maxRetries) {
          throw error;
        }
        console.warn(`Chunk ${index} of ${fileData.name} failed (attempt ${attempt + 1}), retrying`, error);
        await sleep(500 * 2 ** attempt);
      }
    }
  };

  const uploadInChunks = async (
    fileData: FileWithThumbnail,
    fileId: string,
    onProgress: (progress: number) => void
  ) => {
    // Even empty / small files use the chunk endpoint – one code path, with retries
    const totalChunks = Math.max(1, Math.ceil(fileData.file.size / chunkSize));
    const fileInfo = JSON.stringify({
      name: fileData.name,
      type: fileData.type,
      size: fileData.file.size,
      thumbnail: fileData.thumbnail ?? null,
      icon: fileData.icon,
    });

    let uploaded = 0;
    const indexes = Array.from({ length: totalChunks }, (_, i) => i);
    await runPool(indexes, maxConcurrentChunks, async (index) => {
      await uploadChunk(fileData, fileId, index, totalChunks, fileInfo);
      uploaded++;
      onProgress((uploaded / totalChunks) * 100);
    });
  };

  return { processFiles, uploadProgress };
};
