import { useState, useEffect, useRef } from "hono/jsx";
import { hc } from "hono/client";
import type { AppType } from "../server";
import type { MessageHubRoutes } from "../message-hub-do";
import SessionManagementModal from "./SessionManagementModal";
import FileUploader, { FileWithThumbnail, MAX_TOTAL_SIZE } from "./FileUploader";
import { QRCodeDisplay } from "./QRCodeDisplay";
import { formatCodeWithSpacer } from "../utils/formatCode";
import { FormatFileSize } from "./FormatFileSize";
import { useFileUpload } from "../utils/fileUpload";

const getMessageHubClient = (hubId: string) =>
	hc<MessageHubRoutes>(`/${hubId}`);

// Type Definitions
interface Props {
	/** Session code used for WebSocket connection and API endpoints */
	code: string;
	/** Optional callback for when the component is initialized */
	freshSession: boolean;
	/** Optional message to share with the component */
	shareTargetMessage?: string | null;
	/** Optional files to share with the component */
	shareTargetFiles?: File[];
	/** Optional flag to enable auto-send mode */
	autoSend?: boolean;
}

/** Represents a file in the system with its metadata */
interface FileInfo {
	/** Unique identifier for the file */
	id: string;
	/** Original filename */
	name?: string;
	/**file size */
	size?: number;
	/** MIME type or file extension */
	type?: string;
	/** Base64 or URL of the file thumbnail */
	thumbnail?: string | null;
	/** Icon to display when thumbnail is not available */
	icon?: string;
}

/** Different modes of operation for the component */
type ClientMode = "send" | "auto" | "receive";

/**
 * DurableComponent handles file sharing and messaging functionality with WebSocket
 * connection for real-time updates. It maintains connection state and automatically
 * attempts to reconnect on connection loss.
 */
const DurableComponent = ({
	code = "default",
	freshSession = false,
	shareTargetMessage = null,
	shareTargetFiles = [],
	autoSend = false,
}: Props) => {
	// Connection and Status State
	const [status, setStatus] = useState("");
	const [showSessionModal, setShowSessionModal] = useState(false);

	// Message and File State
	const [message, setMessage] = useState("");
	const [files, setFiles] = useState<FileInfo[]>([]);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [selectedFiles, setSelectedFiles] = useState<FileWithThumbnail[]>([]);
	const [shouldClearFiles, setShouldClearFiles] = useState(false);

	// Mode Management
	const [clientMode, setClientMode] = useState<ClientMode>("auto");
	const [isEditableMode, setIsEditableMode] = useState(freshSession);
	const [pickerHold, setPickerHold] = useState(false);
	const [showQRCode, setShowQRCode] = useState(freshSession);
	//autosend
	const [proceedAutosend, setProceedAutosend] = useState(false);
	const [autosendExecuted, setAutosendExecuted] = useState(false);
	const autosendInitiatedRef = useRef(false);
	// sending state
	const [isSending, setIsSending] = useState(false);
	const [filesOverLimit, setFilesOverLimit] = useState(0);
	// User-facing result of the last send (status above is only used for logging)
	const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
	const [hasText, setHasText] = useState(false);
	const [copied, setCopied] = useState(false);

	const wsRef = useRef<WebSocket | null>(null);
	const isConnectingRef = useRef(false);
	const isManualCloseRef = useRef(false);
	const sessionMissingRef = useRef(false);
	// Always-current list of selected files (autosend runs from effects with stale closures)
	const selectedFilesRef = useRef<FileWithThumbnail[]>([]);
	selectedFilesRef.current = selectedFiles;

	//testreturn useeffect
	useEffect(() => {
		console.log("DurableComponent mounted with code:", code);
		// Reset autosend ref when component mounts or code changes
		autosendInitiatedRef.current = false;
		setAutosendExecuted(false);
		setProceedAutosend(false);
		return () => {

			console.log("DurableComponent unmounted with code:", code + "this code fires properly");
		};
	}, [code]);

	useEffect(() => {

		console.log("DurableComponent useEffect -", { code });


		console.log("useEffect - WebSocket connection setup");
		const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/${code}/ws`;

		let attempts = 0;
		let reconnectTimer: ReturnType<typeof setTimeout>;
		const maxRetries = 3;
		const reconnectDelay = 500;


		const connect = () => {

			// Prevent multiple simultaneous connection attempts
			if (isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
				console.log("Connection already in progress or established, skipping...");
				return;
			}
			const ws = new WebSocket(url);
			isConnectingRef.current = true;
			console.log("Connecting to WebSocket:", url);
			wsRef.current = ws;

			ws.onopen = () => {
				attempts = 0;
				setStatus("Connected");
				setShowSessionModal(false);
			};

			ws.onerror = () => setStatus("Connection error");

			ws.onmessage = (e) => {
				try {
					const data = JSON.parse(e.data);
					const { status, message, files, role, mode } = data;

					if (status?.code === 503) {
						sessionMissingRef.current = true;
						setStatus("Session does not exist");
						setMessage("This session has expired or does not exist. Try creating a new session.");
						wsRef.current?.close();
						return;
					}

					setStatus(status?.message || "Connected");
					setMessage(message || "");
					setFiles(files || []);
					setIsEditableMode(role === "host");
					setClientMode(mode || "auto");
				} catch (err) {
					console.error("Message parsing error:", err);
				}
			};

			ws.onclose = () => {
				console.log("WebSocket connection closed -onclose");
				// Reset the connecting flag when connection closes
				isConnectingRef.current = false;

				if (sessionMissingRef.current) return;
				if ((++attempts <= maxRetries) && !isManualCloseRef.current) {
					console.log(`Reconnection attempt (${attempts}/${maxRetries})...`);
					reconnectTimer = setTimeout(connect, reconnectDelay);
				} else {
					setStatus("Failed to connect");
					setShowSessionModal(true);
				}
			};

		};

		const handleVisibility = () => {
			console.log("handleVisibility triggered");
			if (!document.hidden && wsRef.current?.readyState !== WebSocket.OPEN) {
				attempts = 0;
				console.log("connection process visibility change");
				connect();
			}
		};
		console.log("Adding visibilitychange event listener");
		// document.addEventListener("visibilitychange", handleVisibility);
		connect();

		return () => {
			// Reset connecting flag on cleanup
			isConnectingRef.current = false;
			isManualCloseRef.current = true;
			clearTimeout(reconnectTimer);
			// document.removeEventListener("visibilitychange", handleVisibility);
			console.log("event listener for visibilitychange removed");
			console.log(wsRef.current);
			wsRef.current?.close();
			console.log("WebSocket connection closed on cleanup")
			console.log(wsRef.current);
		};
	}, []);

	//autosent executor
	useEffect(() => {
		console.log("Autosend useEffect triggered")
		if (
			autoSend &&
			proceedAutosend &&
			!autosendExecuted &&
			!autosendInitiatedRef.current &&
			(clientMode === "auto" || clientMode === "send")
		) {
			console.log("Executing autosend - sending files and message");
			autosendInitiatedRef.current = true;
			setAutosendExecuted(true);
			setProceedAutosend(false);
			sendMessageAndFiles();
		}
	}, [proceedAutosend]);

	//if there is only text from share target and no files
	useEffect(() => {
		if (
			autoSend &&
			!autosendExecuted &&
			shareTargetFiles.length == 0 &&
			shareTargetMessage &&
			!proceedAutosend  // Prevent setting true if already true
		) {
			setProceedAutosend(true);
		}
	}, [shareTargetMessage]);

	useEffect(() => {
		if (status) {
			console.log("Status changed:", status);
		}
	}, [status]);

	useEffect(() => {
		if (shareTargetMessage && textareaRef.current) {
			textareaRef.current.value = shareTargetMessage;
			setHasText(!!shareTargetMessage.trim());
		}
	}, [shareTargetMessage]);

	useEffect(() => {
		if (wsRef.current?.readyState === 1) {
			// 1 = OPEN
			wsRef.current.send(
				JSON.stringify({
					type: "changeMode",
					mode: clientMode,
				})
			);
		}
	}, [clientMode]);

	useEffect(() => {
		if (wsRef.current?.readyState === 1) {
			// 1 = OPEN
			wsRef.current.send(
				JSON.stringify({
					type: pickerHold ? "pickerHold" : "pickerRelease",
				})
			);
		}
	}, [pickerHold]);

	const { processFiles, uploadProgress } = useFileUpload(code);

	const sendMessageAndFiles = async () => {
		if (isSending) return;

		try {
			setIsSending(true);
			setNotice(null);
			setStatus("Sending...");
			const hubClient = getMessageHubClient(code);
			const message = textareaRef.current?.value || "";

			const filesToSend = selectedFilesRef.current ?? [];
			// Check the limit here too – autosend (share target) bypasses the
			// disabled button and used to upload part of the files, then fail with 413.
			const alreadyUsed = files.reduce((acc, f) => acc + (f.size || 0), 0);
			const toSend = filesToSend.reduce((acc, f) => acc + f.size, 0);
			if (alreadyUsed + toSend > MAX_TOTAL_SIZE) {
				const overMb = ((alreadyUsed + toSend - MAX_TOTAL_SIZE) / 1024 / 1024).toFixed(1);
				setNotice({
					type: "error",
					text: `The session limit is ${MAX_TOTAL_SIZE / 1024 / 1024} MB – exceeded by ${overMb} MB. Remove some files and send again.`,
				});
				return;
			}
			if (filesToSend.length > 0) {
				await processFiles(filesToSend);
			}

			if (message.trim()) {
				type ResponseType = {
					success: boolean;
					error?: { issues?: Array<{ message: string }> };
				};

				const { success, error } = await hubClient.send
					.$post({
						json: { message },
					})
					.then((res) => res.json() as Promise<ResponseType>);

				if (!success && error?.issues) {
					throw new Error(error.issues.map((i) => i.message).join(", "));
				}
			}

			if (textareaRef.current) {
				textareaRef.current.value = "";
			}
			setHasText(false);
			setShouldClearFiles(true);
			setStatus("Sent successfully");
			setNotice({ type: "success", text: "Sent" });
			setTimeout(() => setNotice((n) => (n?.type === "success" ? null : n)), 3000);
		} catch (error) {
			const text = error instanceof Error ? error.message : "Unknown error";
			setStatus(`Error: ${text}`);
			setNotice({ type: "error", text: `Sending failed: ${text}` });
			console.error("Error:", error);
		} finally {
			setIsSending(false);
		}
	};

	const handleDownload = (fileId: string) => {
		try {
			const file = files.find((f) => f.id === fileId);
			const a = document.createElement("a");
			a.href = `/${code}/download/${encodeURIComponent(fileId)}`;
			a.download = file?.name || "file";
			a.rel = "noopener";
			document.body.appendChild(a);
			a.click();
			a.remove();
		} catch (error) {
			setStatus(`Download failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	// Browsers block/merge several downloads started in the same tick –
	// start them one after another with a short pause.
	const handleDownloadAll = async () => {
		for (const [i, file] of files.entries()) {
			if (i > 0) await new Promise((r) => setTimeout(r, 700));
			handleDownload(file.id);
		}
	};

	const handleFilesChange = (newFiles: FileWithThumbnail[]) => {
		setSelectedFiles(newFiles);
		setShouldClearFiles(false);
	};

	const handleReset = () => {
		window.location.href = "/";
	};

	const copyMessage = async () => {
		try {
			await navigator.clipboard.writeText(message);
		} catch {
			// Fallback for insecure contexts / older browsers
			const ta = document.createElement("textarea");
			ta.value = message;
			ta.setAttribute("readonly", "");
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			document.execCommand("copy");
			ta.remove();
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const hasContent = message.trim().length > 0 || files.length > 0;

	/**
	 * Session content (message + files). In preview mode (sender in "send" mode)
	 * it is read-only: the other side is the one receiving it.
	 */
	const renderSessionContent = (preview: boolean) => (
		<div className="message-container">
			{!hasContent && (
				<div className="wait-message">Waiting for message...</div>
			)}
			{message.trim().length > 0 && (
				<div className="message-row">
					<div
						className="received-message"
						dangerouslySetInnerHTML={{ __html: linkify(message) }}
					/>
					<button
						type="button"
						title="Copy message"
						aria-label="Copy message"
						className={`ghost-button message-copy ${copied ? "copied" : ""}`}
						onClick={copyMessage}
					>
						<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true">
							<path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" />
						</svg>
					</button>
				</div>
			)}

			{message.trim().length !== 0 && files.length !== 0 && (
				<div className="divider"></div>
			)}

			{!preview && files.length > 1 && (
				<div className="download-all-container">
					<button
						type="button"
						className="ghost-button download-all"
						title="Download all files"
						onClick={handleDownloadAll}
					>
						<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true">
							<path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z" />
						</svg>
						{" "}Download all ({files.length})
					</button>
				</div>
			)}
			{files.length > 0 && (
				<div className="files-grid">
					{files.map((file) => (
						<div
							className={`file-card ${preview ? "preview" : ""}`}
							key={file.id}
							{...(preview
								? {}
								: {
									role: "button",
									tabIndex: 0,
									"aria-label": `Download ${file.name || "file"}`,
									onClick: () => handleDownload(file.id),
									onKeyDown: (e: KeyboardEvent) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											handleDownload(file.id);
										}
									},
								})}
						>
							<div className="thumbnail">
								{file.thumbnail && file.thumbnail !== "undefined" ? (
									<img src={file.thumbnail} alt="" />
								) : (
									<span className="thumbnail-icon">{file.icon}</span>
								)}
							</div>
							<div className="file-card-content">
								<div className="file-name" title={file.name}>
									{file.name || "Unnamed file"}
								</div>
								<div class="file-info row">
									<FormatFileSize sizeInBytes={file.size} /> {" • "}{file.type || "unknown type"}
								</div>
							</div>
							{!preview && (
								<div className="file-download-icon" title="Download file">
									<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true">
										<path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z" />
									</svg>
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);

	function linkify(text: string): string {
		// Replace special characters with HTML entities (protection against HTML injection)
		const escapedText = text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");

		// Detect links starting with http(s)
		const urlPattern = /(\bhttps?:\/\/[^\s<>"]+[^\s.,!?:;<>")])/gi;

		// Convert links to <a href>
		return escapedText.replace(urlPattern, function (url) {
			return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
		});
	}

	return (
		<>
			<div className="code-holder">
				<div className="code-section">
					<p className="code">{formatCodeWithSpacer(code, [3, 3])}</p>
					<button
						className="ghost-button"
						title={showQRCode ? "Hide QR code" : "Show QR code"}
						onClick={() => setShowQRCode(!showQRCode)}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							height="24px"
							viewBox="0 -960 960 960"
							width="24px"
							fill="currentColor"
						>
							<path d="M520-120v-80h80v80h-80Zm-80-80v-200h80v200h-80Zm320-120v-160h80v160h-80Zm-80-160v-80h80v80h-80Zm-480 80v-80h80v80h-80Zm-80-80v-80h80v80h-80Zm360-280v-80h80v80h-80ZM180-660h120v-120H180v120Zm-60 60v-240h240v240H120Zm60 420h120v-120H180v120Zm-60 60v-240h240v240H120Zm540-540h120v-120H660v120Zm-60 60v-240h240v240H600Zm80 480v-120h-80v-80h160v120h80v80H680ZM520-400v-80h160v80H520Zm-160 0v-80h-80v-80h240v80h-80v80h-80Zm40-200v-160h80v80h80v80H400Zm-190-90v-60h60v60h-60Zm0 480v-60h60v60h-60Zm480-480v-60h60v60h-60Z" />
						</svg>
					</button>
				</div>
				{showQRCode && (
					<QRCodeDisplay
						value={window.location.origin + "/" + code}
						size={200}
						level="M"
						marginSize={1}
						title={`QR code for session ${code}`}
						boostLevel={true}
						bgColor="var(--color-bg)"
						fgColor="var(--color-fg)"
					/>
				)}
			</div>
			{showSessionModal && <SessionManagementModal onReset={handleReset} />}
			<div className="modal durable-component">
				<div className="mode-switcher" role="group" aria-label="Session mode">
					<button
						className={clientMode === "send" ? "active" : ""}
						disabled={!isEditableMode}
						title={isEditableMode ? undefined : "Only the person who created the session can change the mode"}
						onClick={() => setClientMode("send")}
					>
						<span>Send</span>
					</button>
					<button
						className={(clientMode === "auto" ? "active" : "") + " middle"}
						disabled={!isEditableMode}
						title={isEditableMode ? undefined : "Only the person who created the session can change the mode"}
						onClick={() => setClientMode("auto")}
					>
						<span>Auto</span>
					</button>
					<button
						className={clientMode === "receive" ? "active" : ""}
						disabled={!isEditableMode}
						title={isEditableMode ? undefined : "Only the person who created the session can change the mode"}
						onClick={() => setClientMode("receive")}
					>
						<span>Receive</span>
					</button>
				</div>

				{(clientMode === "receive" || clientMode === "auto") && (
					<>
						<h3>Receive</h3>
						{renderSessionContent(false)}
					</>
				)}

				{clientMode === "auto" && <div className="divider"></div>}

				{(clientMode === "send" || clientMode === "auto") && (
					<div className="send-container">
						<h3>Send</h3>
						<textarea
							id="inputMessage"
							ref={textareaRef}
							placeholder="link | message"
							aria-label="Message text"
							onInput={(e: Event) =>
								setHasText(!!(e.target as HTMLTextAreaElement).value.trim())
							}
						/>
						<div>
							<FileUploader
								onStatusChange={setStatus}
								onFilesChange={handleFilesChange}
								onAllFilesProcessed={() => {
									console.log("All files processed callback triggered");
									if (shareTargetFiles.length > 0 && autoSend) {
										setProceedAutosend(true);
									}
								}}
								shouldClear={shouldClearFiles}
								onPickerHoldChange={setPickerHold}
								shareTargetFiles={shareTargetFiles}
								uploadProgress={uploadProgress}
								isSending={isSending}
								alreadyUploadedBytes={files.reduce((acc, file) => acc + (file.size || 0), 0)}
								setFilesOverLimit={setFilesOverLimit}
							/>
							<div className="send-actions">
								<div>
									<button onClick={sendMessageAndFiles} className={`primary ${isSending ? "loading" : ""}`}
										disabled={isSending || filesOverLimit > 0 || (!hasText && selectedFiles.length === 0)}>
										{isSending
											? "Sending..."
											: selectedFiles.length > 0
												? hasText
													? `Send message and files (${selectedFiles.length})`
													: `Send files (${selectedFiles.length})`
												: "Send message"}
									</button>
									<div className="send-notice" role="status" aria-live="polite">
										{notice && (
											<span className={notice.type === "error" ? "error-message" : "success-message"}>
												{notice.text}
											</span>
										)}
									</div>
									{filesOverLimit > 0 && (
										<div className="error-message">
											Limit exceeded by <strong><FormatFileSize sizeInBytes={filesOverLimit} /></strong>.
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
				)}

				{/* In "send" mode the sender can't see the receive section –
				    show a read-only preview of what the other side receives. */}
				{clientMode === "send" && hasContent && (
					<>
						<div className="divider"></div>
						<h3>Sent</h3>
						<p className="preview-hint">Preview – the other side can only receive.</p>
						{renderSessionContent(true)}
					</>
				)}
			</div>
		</>
	);
};

export default DurableComponent;
