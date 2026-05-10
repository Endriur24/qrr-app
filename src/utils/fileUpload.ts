import { useState } from "hono/jsx";
import { hc } from "hono/client";
import type { MessageHubRoutes } from "../message-hub-do";

interface FileUploadOptions {
  maxConcurrentFiles?: number;
  maxConcurrentChunks?: number;
  chunkSize?: number;
  onChunkUpload?: (name: string, progress: number) => void;
}

interface UploadProgress {
  progress: number;
  fileId: string;
}

export const useFileUpload = (code: string, options: FileUploadOptions = {}) => {
  const {
    maxConcurrentFiles = 2,
    maxConcurrentChunks = 3,
    chunkSize = 5 * 1024 * 1024
  } = options;

  const [uploadProgress, setUploadProgress] = useState<Map<string, UploadProgress>>(new Map());

  const processFiles = async (files: FileWithThumbnail[], onChunkUpload?: (name: string, progress: number) => void) => {
    const fileQueue = [...files];
    const progressMap = new Map<string, UploadProgress>();

    while (fileQueue.length > 0) {
      const batch = fileQueue.splice(0, maxConcurrentFiles);
      await Promise.all(
        batch.map(async (fileData) => {
          const fileId = crypto.randomUUID();
          progressMap.set(fileData.name, { progress: 0, fileId });
          setUploadProgress(new Map(progressMap));

          if (fileData.file.size > chunkSize) {
            await uploadInChunks(fileData, fileId, progressMap, onChunkUpload);
          } else {
            await uploadSingleFile(fileData, fileId, progressMap);
          }
        })
      );
    }
  };

  const uploadInChunks = async (
    fileData: FileWithThumbnail,
    fileId: string,
    progressMap: Map<string, UploadProgress>,
    onProgress?: (name: string, progress: number) => void
  ) => {
    const totalChunks = Math.ceil(fileData.file.size / chunkSize);
    const chunks: { index: number; data: Blob }[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fileData.file.size);
      chunks.push({
        index: i,
        data: fileData.file.slice(start, end),
      });
    }

    let uploadedChunks = 0;
    const chunkQueue = [...chunks];

    while (chunkQueue.length > 0) {
      const batchChunks = chunkQueue.splice(0, maxConcurrentChunks);
      await Promise.all(
        batchChunks.map(async ({ index, data }) => {
          const formData = new FormData();
          formData.append("chunk", new File([data], "chunk"));
          formData.append("fileId", fileId);
          formData.append("index", index.toString());
          formData.append("totalChunks", totalChunks.toString());
          formData.append("fileInfo", JSON.stringify({
            name: fileData.name,
            type: fileData.type,
            size: fileData.size,
            thumbnail: fileData.thumbnail,
            icon: fileData.icon,
          }));

          try {
            const response = await fetch(`/${code}/upload-chunk`, {
              method: "POST",
              body: formData,
            });

            if (!response.ok) {
              throw new Error(`Chunk upload failed: ${response.statusText}`);
            }

            uploadedChunks++;
            const progress = (uploadedChunks / totalChunks) * 100;
            progressMap.set(fileData.name, { progress, fileId });
            setUploadProgress(new Map(progressMap));
            onProgress?.(fileData.name, progress);
          } catch (error) {
            console.error(`Error uploading chunk ${index} for file ${fileData.name}:`, error);
            throw error;
          }
        })
      ).catch(async (error) => {
        console.error(`Batch upload failed, retrying...`, error);
        chunkQueue.unshift(...batchChunks);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      });
    }
  };

  const uploadSingleFile = async (
    fileData: FileWithThumbnail,
    fileId: string,
    progressMap: Map<string, UploadProgress>
  ) => {
    try {
      const hubClient = hc<MessageHubRoutes>(`/${code}`);
      await hubClient.upload.$post({
        form: {
          file: fileData.file,
          thumbnail: fileData.thumbnail || undefined,
          icon: fileData.icon,
        },
      });
      progressMap.set(fileData.name, { progress: 100, fileId });
      setUploadProgress(new Map(progressMap));
    } catch (error) {
      console.error(`Error uploading file ${fileData.name}:`, error);
      throw error;
    }
  };

  return { processFiles, uploadProgress };
};

interface FileWithThumbnail {
  name: string;
  file: File;
  type: string;
  size: number;
  thumbnail?: string | null;
  icon?: string;
}
