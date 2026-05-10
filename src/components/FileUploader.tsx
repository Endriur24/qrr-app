import { useState, useEffect } from "hono/jsx";
import { FormatFileSize } from "./FormatFileSize";


const MAX_TOTAL_SIZE = 125 * 1024 * 1024; // 125MB in bytes

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
		setFilesOverLimit(-freeSpace);
	}, [totalSize]);

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
			// Convert File[] to FileList-compatible object
			const fileList = Object.create(shareTargetFiles, {
				item: { value: (index: number) => shareTargetFiles[index] },
				length: { value: shareTargetFiles.length },
				[Symbol.iterator]: {
					value: function* () {
						yield* shareTargetFiles;
					},
				},
			});
			handleFiles(fileList as FileList);
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
			console.error("Error extracting thumbnail:", error);
			icon = "📎";
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

	const extractImageThumbnail = (file: File): Promise<string> => {
		return new Promise((resolve) => {
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d")!;
			const img = new Image();

			img.onload = () => {
				const size = 80;
				canvas.width = size;
				canvas.height = size;

				const aspectRatio = img.width / img.height;
				let drawWidth, drawHeight, drawX, drawY;

				if (aspectRatio > 1) {
					drawWidth = size;
					drawHeight = size / aspectRatio;
					drawX = 0;
					drawY = (size - drawHeight) / 2;
				} else {
					drawWidth = size * aspectRatio;
					drawHeight = size;
					drawX = (size - drawWidth) / 2;
					drawY = 0;
				}

				ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
				resolve(canvas.toDataURL("image/jpeg", 0.7));
			};

			img.src = URL.createObjectURL(file);
		});
	};

	const extractVideoThumbnail = (file: File): Promise<string> => {
		return new Promise((resolve) => {
			const video = document.createElement("video");
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d")!;

			video.addEventListener("loadedmetadata", () => {
				video.currentTime = Math.min(1, video.duration * 0.1);
			});

			video.addEventListener("seeked", () => {
				const size = 80;
				canvas.width = size;
				canvas.height = size;

				const aspectRatio = video.videoWidth / video.videoHeight;
				let drawWidth, drawHeight, drawX, drawY;

				if (aspectRatio > 1) {
					drawWidth = size;
					drawHeight = size / aspectRatio;
					drawX = 0;
					drawY = (size - drawHeight) / 2;
				} else {
					drawWidth = size * aspectRatio;
					drawHeight = size;
					drawX = (size - drawWidth) / 2;
					drawY = 0;
				}

				ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
				resolve(canvas.toDataURL("image/jpeg", 0.7));
				URL.revokeObjectURL(video.src);
			});

			video.src = URL.createObjectURL(file);
			video.muted = true;
			video.load();
		});
	};

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

	const handleFiles = async (files: FileList) => {
		onPickerHoldChange(false);
		onStatusChange?.("Processing files...");

		const newFiles: FileWithThumbnail[] = [];
		let newTotalSize = totalSize;
		let duplicatesFound = false;

		for (let file of files) {
			// Check for duplicates by comparing name and size
			const isDuplicate = selectedFiles.some(
				(existingFile) =>
					existingFile.name === file.name && existingFile.size === file.size
			);

			if (isDuplicate) {
				duplicatesFound = true;
				continue;
			}

			// if (newTotalSize + file.size > remainingSize) {
			// 	onStatusChange?.(
			// 		`Cannot add more files. Size limit is ${formatSize(remainingSize)}`
			// 	);
			// 	return;
			// }

			const processedFile = await extractThumbnail(file);
			processedFile.progress = 0;
			processedFile.uploading = false;
			newFiles.push(processedFile);
			newTotalSize += file.size;
		}

		if (duplicatesFound) {
			onStatusChange?.("Duplicate files were skipped");
		}

		if (newFiles.length === 0) {
			return;
		}

		const updatedFiles = [...selectedFiles, ...newFiles];
		setSelectedFiles(updatedFiles);
		setTotalSize(newTotalSize);
		onFilesChange?.(updatedFiles);
		onStatusChange?.(
			`Using ${formatSize(newTotalSize)} of ${formatSize(remainingSize)}`
		);
		onAllFilesProcessed?.();
		console.log("All files processed");
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
		setSelectedFiles((prev) => {
			const removedFile = prev[indexToRemove];
			const newFiles = prev.filter((_, index) => index !== indexToRemove);
			const newTotalSize = totalSize - removedFile.size;
			setTotalSize(newTotalSize);
			onFilesChange?.(newFiles);
			onStatusChange?.(
				`Using ${formatSize(newTotalSize)} of ${formatSize(remainingSize)}`
			);
			return newFiles;
		});
	};

	const clearFiles = () => {
		setSelectedFiles([]);
		setTotalSize(0);
		onFilesChange?.([]);
		onStatusChange?.("");
	};

	const updateFileProgress = (fileIndex: number, progress: number) => {
		setSelectedFiles((prev) => {
			const updatedFiles = [...prev];
			if (updatedFiles[fileIndex]) {
				updatedFiles[fileIndex] = {
					...updatedFiles[fileIndex],
					progress,
					uploading: progress < 100,
				};
			}
			return updatedFiles;
		});
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
						if (input.files) handleFiles(input.files);
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
