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

// Must match public/service-worker.js
const SHARE_CACHE = "media-share-v1";
const SHARE_MANIFEST = "/__share__/manifest";

interface ShareManifest {
	files: { key: string; name: string; type: string; lastModified: number }[];
	title: string;
	text: string;
	url: string;
	diag?: {
		contentType: string;
		contentLength: string;
		entries: { field: string; kind: string; name?: string; type?: string; size?: number; length?: number }[];
	};
}

/** Reads files/text stored by the service worker and clears the cache */
/** Sends share-target diagnostics to Sentry (loaded via the loader script) */
function reportShareProblem(message: string, extra: unknown) {
	console.warn(message, extra);
	try {
		const S = (window as any).Sentry;
		S?.onLoad?.(() => S.captureMessage(message, { level: "warning", extra: { share: extra } }));
	} catch {
		/* ignore */
	}
}

async function readSharedContent(): Promise<{ files: File[]; text: string | null; problem: string | null }> {
	const cache = await caches.open(SHARE_CACHE);
	const manifestResponse = await cache.match(SHARE_MANIFEST);
	if (!manifestResponse) {
		reportShareProblem("Share target: no manifest in cache", { href: location.href });
		return { files: [], text: null, problem: "No shared data found (the service worker stored nothing)." };
	}

	const manifest: ShareManifest = await manifestResponse.json();
	const files: File[] = [];
	for (const entry of manifest.files) {
		const response = await cache.match(entry.key);
		if (!response) continue;
		const blob = await response.blob();
		files.push(
			new File([blob], entry.name, {
				type: entry.type || blob.type,
				lastModified: entry.lastModified,
			})
		);
	}

	// Files are now held by the page – free the cache
	await caches.delete(SHARE_CACHE);

	// Many apps put the URL into "text" as well – avoid duplicates and empty lines.
	// Some apps (e.g. galleries) pass the file name as title – that's not a message.
	const fileNames = new Set(files.map((f) => f.name.trim()));
	const parts = [manifest.title, manifest.text, manifest.url]
		.map((p) => (p || "").trim())
		.filter(
			(p, i, arr) =>
				p &&
				!fileNames.has(p) &&
				arr.indexOf(p) === i &&
				!(i === 2 && arr[1].includes(p))
		);
	let problem: string | null = null;
	const diag = manifest.diag;
	if (files.length === 0 || files.some((f) => f.size === 0)) {
		const summary = diag
			? diag.entries
				.map((e) => (e.kind === "file" ? `${e.field}: file "${e.name}" (${e.type || "no type"}, ${e.size} B)` : `${e.field}: text (${e.length} chars)`))
				.join("; ") || "no fields"
			: "no diagnostics";
		problem = files.length === 0
			? `The app did not pass any file. Received: ${summary}.`
			: `Some files arrived empty (0 B). Received: ${summary}.`;
		reportShareProblem("Share target: files missing or empty", { diag, manifestFiles: manifest.files, ua: navigator.userAgent });
	}
	return { files, text: parts.length ? parts.join("\n") : null, problem };
}

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

	// ✅ Share Target – runs once on mount (previously a "load" listener was added
	// on every render, which could fire several times or not at all).
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const shareTarget = params.get("share-target");
		if (!shareTarget) return;
		// Remove share-target params from URL (also prevents re-processing on reload)
		window.history.replaceState({}, document.title, window.location.pathname);

		if (shareTarget === "error") {
			setFilesInfo("Could not receive the shared files. Please try again.");
			return;
		}

		(async () => {
			try {
				const { files, text, problem } = await readSharedContent();
				setFilesInfo([...files.map((f) => f.name), problem].filter(Boolean).join("\n"));
				// Set files and text in one go so autosend sees a consistent state
				setSharedText(text);
				setSharedFiles(files);
			} catch (error) {
				console.error("Share target error:", error);
				setFilesInfo("Could not read the shared files.");
			}
		})();
	}, []);

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
				{!currentCode && (sharedFiles.length > 0 || sharedText || filesInfo) && (
					<div class="shared-content-box">
						<h4 class="m0">Ready to send:</h4>
						<div class={css`white-space: pre-line;`}>
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
