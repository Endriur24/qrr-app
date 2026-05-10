import { toCanvas, QRCodeToDataURLOptions } from 'qrcode';
import { useEffect, useRef } from 'hono/jsx';
import { css } from 'hono/css';

interface ImageSettings {
  src: string;
  height: number;
  width: number;
  excavate: boolean;
  x?: number;
  y?: number;
  opacity?: number;
  crossOrigin?: 'anonymous' | 'use-credentials' | '' | undefined;
}

interface QRCodeDisplayProps {
  value: string | string[];
  size?: number;
  level?: 'L' | 'M' | 'Q' | 'H';
  bgColor?: string;
  fgColor?: string;
  marginSize?: number;
  title?: string;
  minVersion?: number;
  boostLevel?: boolean;
  imageSettings?: ImageSettings;
}

export function QRCodeDisplay({ 
  value, 
  size = 128,
  level = 'L',
  bgColor = '#FFFFFF',
  fgColor = '#000000',
  marginSize = 0,
  title,
  minVersion = 3,
  boostLevel = true,
  imageSettings
}: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const renderQRCode = () => {
      const style = getComputedStyle(document.documentElement);
      const computedBgColor = bgColor.startsWith('var(') ? 
        style.getPropertyValue(bgColor.slice(4, -1)) : 
        bgColor;
      const computedFgColor = fgColor.startsWith('var(') ? 
        style.getPropertyValue(fgColor.slice(4, -1)) : 
        fgColor;

      const options: QRCodeToDataURLOptions = {
      width: size,
      margin: marginSize,
      color: {
        dark: computedFgColor,
        light: computedBgColor
      },
      errorCorrectionLevel: level,
      version: minVersion
    };

    // Handle array of segments
    const qrValue = Array.isArray(value) ? value.join('') : value;

    toCanvas(canvasRef.current, qrValue, options, (error: Error | null | undefined) => {
      if (error) console.error(error);

      // If we have image settings, draw the image on top of the QR code
      if (imageSettings && canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.crossOrigin = imageSettings.crossOrigin || 'anonymous';
        img.src = imageSettings.src;

        img.onload = () => {
          const x = imageSettings.x ?? (size - imageSettings.width) / 2;
          const y = imageSettings.y ?? (size - imageSettings.height) / 2;
          
          if (imageSettings.excavate) {
            // Clear the area where image will be placed
          ctx.fillStyle = computedBgColor;
            ctx.fillRect(x, y, imageSettings.width, imageSettings.height);
          }

          ctx.globalAlpha = imageSettings.opacity ?? 1;
          ctx.drawImage(img, x, y, imageSettings.width, imageSettings.height);
          ctx.globalAlpha = 1;
        };
      }
      });
    };

    // Initial render
    renderQRCode();

    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          renderQRCode();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, [value, size, level, bgColor, fgColor, marginSize, minVersion, boostLevel, imageSettings]);

  return (
    <div class={css`display: flex; justify-content: center; align-items: center;`}>
      <canvas 
        ref={canvasRef} 
        height={size} 
        width={size} 
        title={title}
        aria-label={title}
      />
    </div>
  );
}
