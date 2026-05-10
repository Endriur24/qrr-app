interface BarcodeDetectorFormat {
	format: string;
}

interface DetectedBarcode {
	format: string;
	rawValue: string;
	boundingBox: DOMRectReadOnly;
	cornerPoints: ReadonlyArray<{ x: number; y: number }>;
}

interface BarcodeDetectorOptions {
	formats?: string[];
}

declare var BarcodeDetector: {
	new (options?: BarcodeDetectorOptions): {
		detect(source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<DetectedBarcode[]>;
		getSupportedFormats(): Promise<BarcodeDetectorFormat[]>;
	};
};
