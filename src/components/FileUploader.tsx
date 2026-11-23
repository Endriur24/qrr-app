import { useState, useEffect, useRef } from "hono/jsx";
import { FormatFileSize } from "./FormatFileSize";


// Must match MAX_TOTAL_SIZE in message-hub-do.ts (files are kept in server RAM)
export const MAX_TOTAL_SIZE = 80 * 1024 * 1024;

const formatSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

interface Props {
	onStatusChange?: (status: string) => void;
	onFilesChange?: (files: FileWithThumbnail[]) => void;
	onAllFilesProcessed: () => void;
	shouldClear?: boolean;
	onPickerHoldChange: (hold: boolean) => void;
	shareTargetFiles?: File[];
	uploadProgress?: Map<string, { progress: number; fileId: string }>;
	isSending?: boolean;
	alreadyUploadedBytes?: number;
	setFilesOverLimit: (count: number) => void;
}

interface FileWithThumbnail {
	file: File;
	name: string;
	type: string;
	size: number;
	thumbnail: string | null;
	icon?: string;
	progress: number;
	uploading: boolean;
}

const FileUploader = ({
	onStatusChange,
	onFilesChange,
	onAllFilesProcessed,
	shouldClear,
	onPickerHoldChange,
	shareTargetFiles,
	uploadProgress,
	isSending,
	alreadyUploadedBytes,
	setFilesOverLimit
}: Props) => {
	const [selectedFiles, setSelectedFiles] = useState<FileWithThumbnail[]>([]);
	const selectedFilesRef = useRef<FileWithThumbnail[]>([]);
	selectedFilesRef.current = selectedFiles;
	const [isDragging, setIsDragging] = useState(false);
	const [totalSize, setTotalSize] = useState(0);
	const [remainingSize, setRemainingSize] = useState(MAX_TOTAL_SIZE);


	// Update remaining size when alreadyUploadedBytes changes
	useEffect(() => {
		if (alreadyUploadedBytes) {
			setRemainingSize(MAX_TOTAL_SIZE - alreadyUploadedBytes);
		} else {
			setRemainingSize(MAX_TOTAL_SIZE);
		}
	}, [alreadyUploadedBytes]);

	useEffect(() => {
		const freeSpace = remainingSize - totalSize;
		setFilesOverLimit(Math.max(0, -freeSpace));
	}, [totalSize, remainingSize]);

	// Clear files when shouldClear prop changes to true
	useEffect(() => {
		if (shouldClear) {
			clearFiles();
		}
	}, [shouldClear]);

	// handle files from ShareTarget
	useEffect(() => {
		if (shareTargetFiles && shareTargetFiles.length > 0) {
			console.log("Processing shareTargetFiles:", shareTargetFiles.length, "files");
			handleFiles(shareTargetFiles);
		}
	}, [shareTargetFiles]);

	// Sync upload progress from props to local state
	useEffect(() => {
		if (uploadProgress && selectedFiles.length > 0) {
			setSelectedFiles((prev) => {
				const updatedFiles = [...prev];
				uploadProgress.forEach((progressData, fileName) => {
					const fileIndex = updatedFiles.findIndex(file => file.name === fileName);
					if (fileIndex !== -1) {
						updatedFiles[fileIndex] = {
							...updatedFiles[fileIndex],
							progress: progressData.progress,
							uploading: progressData.progress < 100,
						};
					}
				});
				return updatedFiles;
			});
		}
	}, [uploadProgress]);

	const extractThumbnail = async (file: File): Promise<FileWithThumbnail> => {
		const fileType = file.type.toLowerCase();
		let thumbnail: string | null = null;
		let icon: string | undefined;

		try {
			if (fileType.startsWith("image/")) {
				thumbnail = await extractImageThumbnail(file);
			} else if (fileType.startsWith("video/")) {
				thumbnail = await extractVideoThumbnail(file);
			} else {
				icon = getFallbackIcon(fileType);
			}
		} catch (error) {
			console.warn("Thumbnail not available for", file.name, error);
			thumbnail = null;
			icon = fileType.startsWith("image/") ? "🖼️" : fileType.startsWith("video/") ? "🎬" : "📎";
		}

		return {
			file,
			name: file.name,
			type: file.type,
			size: file.size,
			thumbnail,
			icon,
			progress: 0,
			uploading: false,
		};
	};

	const THUMB_SIZE = 80;
	const THUMB_TIMEOUT_MS = 4000;

	/** Draws source into a square canvas keeping aspect ratio */
	const drawThumbnail = (
		source: CanvasImageSource,
		width: number,
		height: number
	): string => {
		const canvas = document.createElement("canvas");
		canvas.width = THUMB_SIZE;
		canvas.height = THUMB_SIZE;
		const ctx = canvas.getContext("2d")!;
		const aspectRatio = width / height || 1;
		const drawWidth = aspectRatio > 1 ? THUMB_SIZE : THUMB_SIZE * aspectRatio;
		const drawHeight = aspectRatio > 1 ? THUMB_SIZE / aspectRatio : THUMB_SIZE;
		ctx.drawImage(
			source,
			(THUMB_SIZE - drawWidth) / 2,
			(THUMB_SIZE - drawHeight) / 2,
			drawWidth,
			drawHeight
		);
		return canvas.toDataURL("image/jpeg", 0.7);
	};

	/**
	 * Runs a thumbnail extractor with a timeout. Unsupported formats (e.g. HEIC,
	 * some video codecs) never fire load/seeked events – previously this left the
	 * promise pending forever and the files were never added to the list.
	 */
	const withObjectUrl = (
		file: File,
		run: (url: string, resolve: (v: string) => void, reject: (e: unknown) => void) => void
	): Promise<string> => {
		const url = URL.createObjectURL(file);
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Thumbnail timeout")), THUMB_TIMEOUT_MS);
			run(
				url,
				(v) => {
					clearTimeout(timer);
					resolve(v);
				},
				(e) => {
					clearTimeout(timer);
					reject(e);
				}
			);
		}).finally(() => URL.revokeObjectURL(url));
	};

	const extractImageThumbnail = (file: File): Promise<string> =>
		withObjectUrl(file, (url, resolve, reject) => {
			const img = new Image();
			img.decoding = "async";
			img.onload = () => {
				try {
					resolve(drawThumbnail(img, img.naturalWidth, img.naturalHeight));
				} catch (e) {
					reject(e);
				}
			};
			img.onerror = reject;
			img.src = url;
		});

	const extractVideoThumbnail = (file: File): Promise<string> =>
		withObjectUrl(file, (url, resolve, reject) => {
			const video = document.createElement("video");
			video.muted = true;
			video.playsInline = true;
			video.preload = "metadata";
			video.addEventListener("loadedmetadata", () => {
				video.currentTime = Math.min(1, (video.duration || 0) * 0.1);
			});
			video.addEventListener("seeked", () => {
				try {
					resolve(drawThumbnail(video, video.videoWidth, video.videoHeight));
				} catch (e) {
					reject(e);
				} finally {
					video.removeAttribute("src");
					video.load();
				}
			});
			video.addEventListener("error", () => reject(video.error));
			video.src = url;
		});

	const getFallbackIcon = (fileType: string): string => {
		const icons: { [key: string]: string } = {
			"application/pdf": "📄",
			"application/msword": "📄",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
				"📄",
			"application/vnd.ms-excel": "📊",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "📊",
			"application/vnd.ms-powerpoint": "📊",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation":
				"📊",
			"application/zip": "🗜️",
			"application/x-rar-compressed": "🗜️",
			"text/plain": "📝",
			"application/json": "📝",
			"text/csv": "📊",
		};

		return icons[fileType] || "📎";
	};

	const handleFiles = async (files: FileList | File[]) => {
		onPickerHoldChange(false);
		onStatusChange?.("Processing files...");

		// Use refs – this function is also called from effects / async callbacks
		// where the captured state may already be stale.
		const current = selectedFilesRef.current ?? [];
		const seen = new Set(current.map((f) => `${f.name}|${f.size}`));
		const toProcess: File[] = [];
		let duplicatesFound = false;

		for (const file of Array.from(files)) {
			const key = `${file.name}|${file.size}`;
			if (seen.has(key)) {
				duplicatesFound = true;
				continue;
			}
			seen.add(key);
			toProcess.push(file);
		}

		if (duplicatesFound) {
			onStatusChange?.("Duplicate files were skipped");
		}

		if (toProcess.length === 0) {
			return;
		}

		// Thumbnails in parallel (each one has its own timeout)
		const newFiles = await Promise.all(toProcess.map(extractThumbnail));

		const updatedFiles = [...(selectedFilesRef.current ?? []), ...newFiles];
		const newTotalSize = updatedFiles.reduce((acc, f) => acc + f.size, 0);
		selectedFilesRef.current = updatedFiles;
		setSelectedFiles(updatedFiles);
		setTotalSize(newTotalSize);
		onFilesChange?.(updatedFiles);
		onStatusChange?.(
			`Using ${formatSize(newTotalSize)} of ${formatSize(remainingSize)}`
		);
		onAllFilesProcessed?.();
	};

	const handleDrop = (e: {
		preventDefault: () => void;
		dataTransfer?: { files: FileList };
	}) => {
		e.preventDefault();
		setIsDragging(false);
		if (e.dataTransfer?.files) {
			handleFiles(e.dataTransfer.files);
		}
	};

	const removeFile = (indexToRemove: number) => {
		const newFiles = (selectedFilesRef.current ?? []).filter((_, index) => index !== indexToRemove);
		const newTotalSize = newFiles.reduce((acc, f) => acc + f.size, 0);
		selectedFilesRef.current = newFiles;
		setSelectedFiles(newFiles);
		setTotalSize(newTotalSize);
		onFilesChange?.(newFiles);
		onStatusChange?.(
			`Using ${formatSize(newTotalSize)} of ${formatSize(remainingSize)}`
		);
	};

	const clearFiles = () => {
		selectedFilesRef.current = [];
		setSelectedFiles([]);
		setTotalSize(0);
		onFilesChange?.([]);
		onStatusChange?.("");
	};

	const onfileinputClick = (e: { stopPropagation: () => void }) => {
		e.stopPropagation();
		onPickerHoldChange(true);
		console.log("Picker hold activated");
		document.getElementById("fileInput")?.click();
	};

	return (
		<div class="file-upload-container">
			<div
				class={`upload-area ${isDragging ? "dragover" : ""}`}
				onDragOver={(e: { preventDefault: () => void }) => {
					e.preventDefault();
					setIsDragging(true);
				}}
				onDragLeave={() => setIsDragging(false)}
				onDrop={handleDrop}
				onClick={onfileinputClick}
			>
				<div class="upload-text">Drop files or click</div>
				<div class="upload-subtext">
					{totalSize > 0
						? `${formatSize(totalSize)} z ${formatSize(remainingSize)}`
						: `Limit: ${formatSize(remainingSize)}`}
				</div>
				<input
					id="fileInput"
					type="file"
					multiple
					accept="*/*"
					onChange={(e) => {
						const input = e.target as HTMLInputElement;
						if (input.files) handleFiles(Array.from(input.files));
						input.value = "";
					}}
					style={{ display: "none" }}
				/>
			</div>

			{selectedFiles.length > 0 && (
				<div class="files-grid">
					{selectedFiles.map((file, index) => (
						<div class="file-card" key={index}>
							{isSending ? !true :
								<button
									class="remove-file"
									onClick={(e) => {
										e.stopPropagation();
										removeFile(index);
									}}
									title="Remove file from list"
								>
									✕
								</button>
							}

							<div class="thumbnail">
								{file.thumbnail ? (
									<img src={file.thumbnail} alt="Thumbnail" />
								) : (
									<span class="thumbnail-icon">{file.icon}</span>
								)}
							</div>
							<div class="file-card-content">
								<div class="file-name" title={file.name}>{file.name}</div>
								<div class="file-info">
									<div>
										<FormatFileSize sizeInBytes={file.size} /> •{" "}{file.type || "Unknown type"}
									</div>
									{file.uploading && (<>
										<progress value={file.progress} max="100"></progress>
										<span className="percent">
											{Math.round(file.progress)}%
										</span>
									</>
									)}
								</div>
							</div>
							<div style={{ opacity: file.progress === 100 ? '1' : '0' }}>
								<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" /></svg>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
};

export type { FileWithThumbnail };
export default FileUploader;
