/**
 * React component that formats and displays a file size.
 * Displays in KB for sizes less than 1 MB, otherwise in MB.
 */
export function FormatFileSize({ sizeInBytes }: { sizeInBytes?: number }) {
	if (!sizeInBytes) return null;

	if (sizeInBytes < 1024) {
		// Less than 1 KB
		return <span>{sizeInBytes} B</span>;
	}

	const sizeInKB = sizeInBytes / 1024;

	if (sizeInKB >= 1024) {
		// Display in MB
		return <span title={sizeInKB.toFixed(2) + " KB"}>{(sizeInKB / 1024).toFixed(2)} MB</span>;
	} else {
		// Display in KB
		return <span>{sizeInKB.toFixed(1)} KB</span>;
	}
}
