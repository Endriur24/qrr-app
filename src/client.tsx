// client.tsx
import { hc } from "hono/client";
import type { AppType } from "./server";
import { render } from "hono/jsx/dom";
import { useEffect, useState, useRef } from "hono/jsx";
import Cookies from "js-cookie";
import { css, Style } from "hono/css";
import DurableComponent from "./components/DurableComponent";
import CodeInputModal from "./components/CodeInputModal";
import LeaveSessionModal from "./components/LeaveSessionModal";

export const client = hc<AppType>("/");

function App() {
	// State management
	const [currentCode, setCurrentCode] = useState<string | null>(() => {
		// ✅ Initialize directly from URL
		const code = window.location.pathname.slice(1);
		return /^\d{6}$/.test(code) ? code : null;
	});
	const [showCodeInput, setShowCodeInput] = useState(false);
	const [initializedHere, setInitializedHere] = useState(false);
	const [sharedFiles, setSharedFiles] = useState<File[]>([]);
	const [sharedText, setSharedText] = useState<string | null>(null);
	const [filesInfo, setFilesInfo] = useState("");
	const [autoSend, setAutoSend] = useState(() => {
		try {
			const saved = Cookies.get("autoSend");
			console.log("Loaded autoSend from cookies:", saved);
			return saved !== undefined ? saved === "true" : true;
		} catch (error) {
			console.error("Error reading autoSend cookie:", error);
			return true;
		}
	});

	const [showLeaveSessionModal, setShowLeaveSessionModal] = useState(false);

	const durableComponentRef = useRef<{ closeWebSocket: () => void } | null>(null);

	// ✅ Service Worker - tylko raz
	useEffect(() => {
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.register("/service-worker.js").catch(console.error);
		}
	}, []);

	// ✅ Share Target 
	window.addEventListener("load", async () => {
		if (location.search.includes("share-target")) {
			const url = new URLSearchParams(window.location.search);
			const fileList = url.get("files");
			const fileListParsed = fileList ? fileList.split(",") : [];
			// Set files info for display line by line
			setFilesInfo(
				fileListParsed.length > 0
					? fileListParsed.map((file) => `${file}`).join("\n")
					: "No files shared"
			);
			const keys = await caches.keys();
			const mediaCache = await caches.open(
				keys.filter((key) => key.startsWith("media"))[0]
			);
			for (const file of fileListParsed) {
				const response = await mediaCache.match(file);
				if (response) {
					const blob = await response.blob();
					const fileObj = new File([blob], file, { type: blob.type });
					setSharedFiles((prev) => [...prev, fileObj]);
					await mediaCache.delete(file);
				}
			}

			const title = url.get("name");
			const text = url.get("description");
			const surl = url.get("link");
			if (title || text || url) {
				setSharedText(`${title || ""}\n${text || ""}\n${surl || ""}`);
			}
			//push state to remove share-target params from URL
			window.history.replaceState({}, document.title, window.location.pathname);
		}
	});

	// ✅ Handle browser back/forward
	useEffect(() => {
		const handlePopState = () => {
			const code = window.location.pathname.slice(1);
			const validCode = /^\d{6}$/.test(code) ? code : null;
			setCurrentCode(validCode);

			if (!validCode && durableComponentRef.current) {
				durableComponentRef.current.closeWebSocket();
			}
		};

		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	// ✅ Toggle homepage visibility
	useEffect(() => {
		document.querySelectorAll(".homepage-only").forEach(el => {
			el.classList.toggle("visually-hidden", !!currentCode);
		});

		if (currentCode) {
			setSharedFiles([]);
			setSharedText(null);
		}
	}, [currentCode]);

	// ✅ Navigation helper
	const navigate = (code: string) => {
		window.history.pushState({}, "", `/${code}`);
		setCurrentCode(code || null);
	};

	// ✅ Create new session
	const handleCreateCode = async () => {
		setShowCodeInput(false);
		try {
			const response = await client.getid.$post();
			if (response.ok) {
				const { id } = await response.json();
				setInitializedHere(true);
				navigate(id);
			} else {
				alert("Session creation error");
			}
		} catch (error) {
			alert("Server connection error");
		}
	};

	// ✅ Connect to existing session
	const handleCodeSubmit = async (code: string) => {
		if (!/^\d{6}$/.test(code)) {
			alert("Enter 6-digit session code");
			return;
		}

		try {
			const response = await client.checkid.$post({ query: { id: code } });
			const { success, error } = await response.json();

			if (success) {
				navigate(code);
				setShowCodeInput(false);
			} else {
				alert(error || "Error connecting to session");
			}
		} catch (error) {
			alert("Server connection error");
		}
	};

	return (
		<>
			<Style />
			<main>
				<h2 
					class="mid logo" 
					onClick={() => {
						if (currentCode) setShowLeaveSessionModal(true);
						else if (showCodeInput) setShowCodeInput(false);
					}}
					style={(currentCode || showCodeInput) ? "cursor: pointer;" : ""}
				>
					qrr.app
				</h2>
				{showLeaveSessionModal && (
					<LeaveSessionModal
						onLeave={() => {
							setShowLeaveSessionModal(false);
							navigate("");
						}}
						onStay={() => setShowLeaveSessionModal(false)}
					/>
				)}
				<div class="mb1">
					{currentCode ? (
						<>
							<DurableComponent
								key={currentCode}
								code={currentCode}
								freshSession={initializedHere}
								shareTargetMessage={sharedText}
								shareTargetFiles={sharedFiles}
								autoSend={autoSend}
							/>
							<div class={css`text-align: left;`}>
								<button
									class={css`margin-top: 2em;`}
									onClick={() => navigate("")}
								>
									<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
										<path d="m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z" />
									</svg>
									{" "}Leave session
								</button>
							</div>
						</>
					) : showCodeInput ? (
						<CodeInputModal
							onClose={() => setShowCodeInput(false)}
							onSubmit={handleCodeSubmit}
						/>
					) : (
						<div class={css`
							display: flex;
							justify-content: center;
							align-items: center;
							flex-direction: row;
							margin-bottom: 20vh;
							text-align: center;
						`}>
							<button class="primary" onClick={handleCreateCode}>
								<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="CurrentColor">
									<path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
								</svg>
								New session
							</button>
							<button onClick={() => setShowCodeInput(true)}>
								<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="CurrentColor">
									<path d="M280-400q-33 0-56.5-23.5T200-480q0-33 23.5-56.5T280-560q33 0 56.5 23.5T360-480q0 33-23.5 56.5T280-400Zm0 160q-100 0-170-70T40-480q0-100 70-170t170-70q67 0 121.5 33t86.5 87h352l120 120-180 180-80-60-80 60-85-60h-47q-32 54-86.5 87T280-240Zm0-80q56 0 98.5-34t56.5-86h125l58 41 82-61 71 55 75-75-40-40H435q-14-52-56.5-86T280-640q-66 0-113 47t-47 113q0 66 47 113t113 47Z" />
								</svg>
								I have a code!
							</button>
						</div>
					)}
				</div>
				{/* Share Target Preview */}
				{!currentCode && (sharedFiles.length > 0 || sharedText) && (
					<div class="shared-content-box">
						<h4 class="m0">Ready to send:</h4>
						<div>
									{filesInfo}
							{sharedText && <p>{sharedText}</p>}
						</div>
						<div class="divider"></div>
						<input
							type="checkbox"
							id="autoSend"
							checked={autoSend}
							onChange={(e) => {
								const checked = (e.target as HTMLInputElement).checked;
								setAutoSend(checked);
								try {
									Cookies.set("autoSend", checked.toString(), {
										expires: 365,
										sameSite: 'strict',
										secure: window.location.protocol === 'https:'
									});
								} catch (error) {
									console.error("Error setting autoSend cookie:", error);
								}
							}}
							class={css`height: 1em; width: 1em;`}
						/>
						<label for="autoSend">Auto-send</label>
					</div>
				)}
			</main>
		</>
	);
}

// ✅ Render only once
const root = document.getElementById("root")!;
if (!root.dataset.rendered) {
	root.dataset.rendered = "true";
	render(<App />, root);
}
