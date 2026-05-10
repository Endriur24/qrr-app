import { useEffect, useRef } from "hono/jsx";

interface WebSocketMessage {
  status?: {
    code?: number;
    message?: string;
  };
  message?: string;
  files?: Array<{
    id: string;
    name?: string;
    type?: string;
    thumbnail?: string | null;
    icon?: string;
  }>;
  role?: string;
  mode?: "send" | "auto" | "receive";
}

interface WebSocketCallbacks {
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onMessage?: (data: WebSocketMessage) => void;
  onClose?: () => void;
}

interface WebSocketOptions {
  maxRetries?: number;
  reconnectDelay?: number;
}

export const useWebSocketConnection = (
  url: string,
  callbacks: WebSocketCallbacks,
  options: WebSocketOptions = {}
) => {
  const wsRef = useRef<WebSocket | null>(null);
  const { maxRetries = 3, reconnectDelay = 500 } = options;

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    let isDisconnected = false;

    const tryReconnect = () => {
      if (attempts >= maxRetries) {
        callbacks.onClose?.();
        return;
      }

      if (isDisconnected && attempts < maxRetries) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, reconnectDelay);
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && isDisconnected) {
        attempts = 0; // Reset attempts when page becomes visible
        tryReconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const connect = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket(url);
      wsRef.current = ws;

      const handleError = (event: Event) => {
        callbacks.onError?.(event);
      };

      const handleOpen = () => {
        attempts = 0;
        isDisconnected = false;
        callbacks.onOpen?.();
      };

      const handleMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          callbacks.onMessage?.(data);
        } catch (error) {
          console.error("Error processing message:", error);
        }
      };

      const handleClose = () => {
        
        isDisconnected = true;
        attempts++;
        tryReconnect();
      };

      ws.addEventListener("error", handleError);
      ws.addEventListener("open", handleOpen);
      ws.addEventListener("message", handleMessage);
      ws.addEventListener("close", handleClose);

      return {
        ws,
        cleanup: () => {
          ws.removeEventListener("error", handleError);
          ws.removeEventListener("open", handleOpen);
          ws.removeEventListener("message", handleMessage);
          ws.removeEventListener("close", handleClose);
        }
      };
    };

    const { ws, cleanup } = connect();

    return () => {
      clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanup();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [url, maxRetries, reconnectDelay]);

  return { wsRef };
};
