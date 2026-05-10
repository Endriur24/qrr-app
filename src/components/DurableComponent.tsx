import { useState, useEffect, useRef } from "hono/jsx";
import { hc } from "hono/client";
import type { AppType } from "../server";
import type { MessageHubRoutes } from "../message-hub-do";
import SessionManagementModal from "./SessionManagementModal";
import FileUploader, { FileWithThumbnail } from "./FileUploader";
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

	const wsRef = useRef<WebSocket | null>(null);
	const isConnectingRef = useRef(false);
	const isManualCloseRef = useRef(false);

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

				if (status === "Session does not exist") return;
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

	const { processFiles, uploadProgress } = useFileUpload(code, {
		onChunkUpload: (name, progress) => {
			setStatus(`Uploading ${name}: ${Math.round(progress)}%`);
		},
	});

	const sendMessageAndFiles = async () => {
		if (isSending) return;

		try {
			setIsSending(true);
			setStatus("Sending...");
			const hubClient = getMessageHubClient(code);
			const message = textareaRef.current?.value || "";

			if (selectedFiles.length > 0) {
				await processFiles(selectedFiles);
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
			setShouldClearFiles(true);
			// if (isEditableMode) {
			// 	setClientMode("send");
			// }
			setStatus("Sent successfully");
		} catch (error) {
			setStatus(
				`Error: ${error instanceof Error ? error.message : "Unknown error"}`
			);
			console.error("Error:", error);
		} finally {
			setIsSending(false);
		}
	};

	const handleDownload = async (fileId: string) => {
		setStatus("Downloading file...");
		try {
			const file = files.find((f) => f.id === fileId);
			const fileName = file?.name || "file";

			const downloadUrl = `/${code}/download/${fileId}`;
			
			const a = document.createElement("a");
			a.href = downloadUrl;
			a.download = fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);

			setStatus("");
		} catch (error) {
			setStatus(`Download failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleFilesChange = (newFiles: FileWithThumbnail[]) => {
		setSelectedFiles(newFiles);
		setShouldClearFiles(false);
	};

	const handleReset = () => {
		window.location.href = "/";
	};

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
				<div className="mode-switcher">
					<button
						className={clientMode === "send" ? "active" : ""}
						disabled={!isEditableMode}
						onClick={() => setClientMode("send")}
					>
						<span>Send</span>
					</button>
					<button
						className={(clientMode === "auto" ? "active" : "") + " middle"}
						disabled={!isEditableMode}
						onClick={() => setClientMode("auto")}
					>
						<span>Auto</span>
					</button>
					<button
						className={clientMode === "receive" ? "active" : ""}
						disabled={!isEditableMode}
						onClick={() => setClientMode("receive")}
					>
						<span>Receive</span>
					</button>
				</div>

				{(clientMode === "receive" || clientMode === "auto") && (
					<>
						<h3>Receive</h3>
						<div className="message-container">
							{message.trim().length == 0 && files.length == 0 && (
								<div className="wait-message">Waiting for message...</div>
							)}
							{message.trim().length > 0 && (
								<div className="message-copy">
									<button
										title="Copy message"
										className="ghost-button"
										onClick={(e: Event) => {
											navigator.clipboard.writeText(message);
											const button = e.target as HTMLElement;
											const buttonElement = button.closest(
												".ghost-button"
											) as HTMLElement;
											buttonElement.classList.add("copied");
											setTimeout(
												() => buttonElement.classList.remove("copied"),
												1500
											);
										}}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											height="24px"
											viewBox="0 -960 960 960"
											width="24px"
											fill="currentColor"
										>
											<path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" />
										</svg>
									</button>
								</div>
							)}

							<div
								id="recieveMessage"
								dangerouslySetInnerHTML={{ __html: linkify(message) }}
							/>

							{message.trim().length !== 0 && files.length !== 0 && (
								<div className="divider"></div>
							)}

							{files.length > 1 && (
								<div className="download-all-container">
									<button
										className="ghost-button download-all"
										title="Download all files"
										onClick={() =>
											files.forEach((file) => handleDownload(file.id))
										}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											height="24px"
											viewBox="0 -960 960 960"
											width="24px"
											fill="currentColor"
										>
											<path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z" />
										</svg>
										{""}({files.length})
									</button>
								</div>
							)}
							<div className="files-grid">
								{files.length > 0
									? files.map((file) => (
										<div
											className="file-card"
											key={file.id}
											onClick={() => handleDownload(file.id)}
										>
											<div className="thumbnail">
												{file.thumbnail && file.thumbnail !== "undefined" ? (
													<img src={file.thumbnail} alt="Thumbnail" />
												) : (
													<span className="thumbnail-icon">{file.icon}</span>
												)}
											</div>
											<div className="file-card-content">
												<div className="file-name" title={file.name}>
													{file.name || "Unnamed file"}
												</div>
												<div class="file-info row">
													<FormatFileSize sizeInBytes={file.size} /> {" • "}{file.type || "Unknown type"}
												</div>
											</div>
											<div className="file-download-icon" title="Download file">
												<svg
													xmlns="http://www.w3.org/2000/svg"
													height="24px"
													viewBox="0 -960 960 960"
													width="24px"
													fill="currentColor"
												>
													<path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z" />
												</svg>
											</div>
										</div>
									))
									: ""}
							</div>
						</div>
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
										disabled={isSending || filesOverLimit > 0}>
										{isSending
											? "Sending..."
											: selectedFiles.length > 0
												? `Send message and files (${selectedFiles.length})`
												: "Send message"}
									</button>
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
			</div>
		</>
	);
};

export default DurableComponent;
