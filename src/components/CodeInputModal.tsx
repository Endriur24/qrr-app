import { useState, useEffect, useRef } from "hono/jsx";
import { OTPInput } from "./otp-input";
import { css } from "hono/css";

const isScannerSupported =
	typeof window !== "undefined" && "BarcodeDetector" in window;

export default function CodeInputModal({
	onClose,
	onSubmit,
}: {
	onClose: () => void;
	onSubmit: (code: string) => void;
}) {
	const [otp, setOtp] = useState("");
	const [showScanner, setShowScanner] = useState(false);
	const [scannerError, setScannerError] = useState("");
	const videoRef = useRef<HTMLVideoElement>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const animFrameRef = useRef<number>(0);
	const detectorRef = useRef<BarcodeDetector | null>(null);

	useEffect(() => {
		if (!showScanner) return;

		let cancelled = false;

		const startScanner = async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: "environment" },
				});
				if (cancelled) {
					stream.getTracks().forEach((t) => t.stop());
					return;
				}
				streamRef.current = stream;
				if (videoRef.current) {
					videoRef.current.srcObject = stream;
					await videoRef.current.play();
				}
				detectorRef.current = new BarcodeDetector({ formats: ["qr_code"] });
				scanFrame();
			} catch (err) {
				if (!cancelled) {
					setScannerError("Failed to start camera");
					console.error(err);
				}
			}
		};

		const scanFrame = () => {
			if (cancelled || !videoRef.current || !detectorRef.current) return;
			if (videoRef.current.readyState >= 2) {
				detectorRef.current
					.detect(videoRef.current)
					.then((barcodes) => {
						if (cancelled || barcodes.length === 0) return;
						const raw = barcodes[0].rawValue || "";
						const match = raw.match(/(\d{6})/);
						if (match) {
							onSubmit(match[1]);
						}
					})
					.catch(() => {});
			}
			animFrameRef.current = requestAnimationFrame(scanFrame);
		};

		startScanner();

		return () => {
			cancelled = true;
			cancelAnimationFrame(animFrameRef.current);
			streamRef.current?.getTracks().forEach((t) => t.stop());
			streamRef.current = null;
		};
	}, [showScanner]);

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		onSubmit(otp);
	};

	return (
		<div className="modal pt0 mb1">
			<form
				class={css`
					text-align: center;
					flex-direction: column;
					display: flex;
				`}
				onSubmit={handleSubmit}
			>
				<h3>Enter session code</h3>
				<div
					className="otp-input-container"
					style="position: relative;"
				>
					<div style="display: flex; justify-content: center; align-items: center;">
						<OTPInput
							length={6}
							onChange={setOtp}
							value={otp}
							autoFocus
							inputType="number"
							containerClass="otp-demo"
							inputsExtraSpace={3}
							inputClass="otp-input-style"
						/>
					</div>
					{isScannerSupported && (
						<button
							type="button"
							class={css`
								display: flex;
								align-items: center;
								justify-content: center;
								margin: 0;
								padding: 0.5em;
								background: transparent;
								cursor: pointer;
								color: inherit;
								transition: background 0.2s;
								position: absolute;
								right: -3em;
								top: 50%;
								border: none;
								box-shadow: none;
								transform: translateY(-50%);
							`}
							onClick={() => {
								if (showScanner) {
									setShowScanner(false);
									setScannerError("");
								} else {
									setShowScanner(true);
								}
							}}
							title={showScanner ? "Close scanner" : "Scan QR code"}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								fill="currentColor"
								class="bi bi-qr-code-scan"
								viewBox="0 0 16 16"
							>
								<path d="M0 .5A.5.5 0 0 1 .5 0h3a.5.5 0 0 1 0 1H1v2.5a.5.5 0 0 1-1 0zm12 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V1h-2.5a.5.5 0 0 1-.5-.5M.5 12a.5.5 0 0 1 .5.5V15h2.5a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5m15 0a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1H15v-2.5a.5.5 0 0 1 .5-.5M4 4h1v1H4z" />
								<path d="M7 2H2v5h5zM3 3h3v3H3zm2 8H4v1h1z" />
								<path d="M7 9H2v5h5zm-4 1h3v3H3zm8-6h1v1h-1z" />
								<path d="M9 2h5v5H9zm1 1v3h3V3zM8 8v2h1v1H8v1h2v-2h1v2h1v-1h2v-1h-3V8zm2 2H9V9h1zm4 2h-1v1h-2v1h3zm-4 2v-1H8v1z" />
								<path d="M12 9h2V8h-2z" />
							</svg>
						</button>
					)}
				</div>
				{showScanner && (
					<div
						class={css`
							display: flex;
							flex-direction: column;
							align-items: center;
							gap: 0.5em;
							margin-top: 0.5em;
						`}
					>
						<video
							ref={videoRef}
							playsinline
							style="width: 100%; max-width: 280px; border-radius: 12px; background: #000;"
						/>
						{scannerError && (
							<p style="color: red; margin: 0;">{scannerError}</p>
						)}
						<p class="mb05" style="font-size: 0.85em; opacity: 0.7;">
							Point camera at QR code
						</p>
					</div>
				)}
				<div
					class={css`
						text-align: center;
						flex-direction: row;
						display: flex;
						width: 100%;
						justify-content: center;
						gap: 0.5em;
						margin-top: 0.5em;
					`}
				>
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button type="submit">Connect</button>
				</div>
			</form>
		</div>
	);
}
