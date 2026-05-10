import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { DurableObject } from "cloudflare:workers";
import { getCookie } from "hono/cookie";

// Schema definitions
/** Schema for send message validation */
export const sendSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
});

/** Schema for file upload validation */
export const uploadSchema = z.object({
  file: z.instanceof(File),
  thumbnail: z.string().optional(),
  icon: z.string().optional(),
});

/** Schema for chunk upload validation */
export const chunkUploadSchema = z.object({
  chunk: z.instanceof(Blob),
  fileId: z.string(),
  index: z.string().transform(val => parseInt(val, 10)),
  totalChunks: z.string().transform(val => parseInt(val, 10)),
  fileInfo: z.string().transform(val => {
    const parsed = JSON.parse(val);
    return {
      name: parsed.name,
      type: parsed.type,
      size: parsed.size,
      thumbnail: parsed.thumbnail,
      icon: parsed.icon,
    };
  }),
});

/**
 * Connection metadata for WebSocket connections
 */
export interface Connection {
  role: "host" | "guest";
  ws: WebSocket;
}

/**
 * File data structure for uploaded files
 */
export interface FileData {
  data: ArrayBuffer;
  size: number;
  type: string;
  name: string;
  thumbnail: string | null;
  icon?: string;
}

/**
 * Chunk data structure for file chunks
 */
interface ChunkData {
  chunks: ArrayBuffer[];
  totalChunks: number;
  receivedChunks: number;
  fileInfo: {
    name: string;
    type: string;
    size: number;
    thumbnail: string | null;
    icon?: string;
  };
}

type Variables = {
  do: QrrAppDO;
};

/**
 * MessageHub Durable Object for handling WebSocket messaging and file transfers
 */
export class QrrAppDO extends DurableObject {
  public app: Hono<{ Variables: Variables }>;
  public connections: Connection[] = [];
  public message = "";
  public files = new Map<string, FileData>();
  public fileChunks = new Map<string, ChunkData>();
  public initialized = false;
  public hostCode = Math.floor(Math.random() * 10000000)
    .toString()
    .padStart(8, "0");
  /** Mode of operation: "auto" | "send" | "receive" */
  public hostsMode = "auto";

  constructor(state: DurableObjectState, env: {}) {
    super(state, env);
    this.ctx = state;

    this.ctx.blockConcurrencyWhile(async () => {
      this.initialized = (await this.ctx.storage.get("initialized")) || false;
      this.hostCode = (await this.ctx.storage.get("hostCode")) || this.hostCode;
      this.hostsMode = (await this.ctx.storage.get("hostsMode")) || "auto";
    });

    // Initialize routes
    this.app = createMessageHubRoutes(this);
  }

  public setInitialized(): string {
    this.initialized = true;
    return this.hostCode;
  }

  public async isInitialized(): Promise<boolean> {
    return this.initialized;
  }

  /**
   * Determines the mode for a given connection based on role and hostsMode
   */
  private getConnectionMode(connection: Connection): string {
    if (connection.role === "host") {
      return this.hostsMode;
    }

    if (this.hostsMode === "auto") {
      return "auto";
    }

    return this.hostsMode === "send" ? "receive" : "send";
  }

  public broadcast(code: number = 200, statusMessage: string = "OK"): void {
    this.connections.forEach((connection) => {
      const mode = this.getConnectionMode(connection);
      const data = JSON.stringify({
        status: {
          code,
          message: statusMessage,
        },
        role: connection.role,
        mode,
        message: this.message,
        files: Array.from(this.files.entries()).map(([id, file]) => ({
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          thumbnail: file.thumbnail,
          icon: file.icon,
        })),
      });
      connection.ws.send(data);
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  public handleWebSocketUpgrade(sessionHost: string): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    if (!this.initialized) {
      server.close(4000, "Durable Object not initialized yet");
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    let currentRole: "host" | "guest" = "guest";
    if (sessionHost == this.hostCode) {
      currentRole = "host";
    }

    const connection: Connection = {
      role: currentRole,
      ws: server,
    };
    this.connections.push(connection);

    server.addEventListener("message", (event) => {
      this.webSocketMessage(server, event.data);
    });

    server.addEventListener("close", () => {
      console.log("WebSocket closed");
      this.connections = this.connections.filter((conn) => conn.ws !== server);
      //force connection close
      server.close(1000, "Connection closed by client");

    });

    this.broadcast(200, "Initial state");

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, messageData: string): Promise<void> {
    const connection = this.connections.find((conn) => conn.ws === ws);
    if (!connection) {
      return;
    }

    try {
      const parsedMessage = JSON.parse(messageData);

      switch (parsedMessage.type) {
        case "changeMode":
          if (connection.role === "host") {
            if (parsedMessage.mode === "auto") {
              this.hostsMode = "auto";
            } else if (parsedMessage.mode === "send") {
              this.hostsMode = "send";
            } else if (parsedMessage.mode === "receive") {
              this.hostsMode = "receive";
            } else {
              console.error("Unknown mode:", parsedMessage.mode);
            }
          }
          break;

        case "pickerHold":
          if (connection.role === "host") {
            await this.ctx.storage.put("initialized", this.initialized);
            await this.ctx.storage.put("hostCode", this.hostCode);
            await this.ctx.storage.put("hostsMode", this.hostsMode);
            this.ctx.storage.setAlarm(Date.now() + 1000 * 60 * 5);
          } else {
            ws.send("Only host can hold");
          }
          break;

        case "pickerRelease":
          if (connection.role === "host") {
            await this.ctx.storage.deleteAll();
            await this.ctx.storage.deleteAlarm();
            console.log("Storage cleared and alarm deleted");
          }
          break;
      }
      this.broadcast();
    } catch (e) {
      console.error("Error processing WebSocket message:", e);
      ws.send("Some error occurred while processing data from WebSocket");
    }
  }

  async send(message: string): Promise<string> {
    this.message = message;
    this.broadcast(200, "Message sent successfully");
    return this.message;
  }

  async handleChunkUpload(fileId: string, chunk: ArrayBuffer, index: number, totalChunks: number, fileInfo: ChunkData['fileInfo']): Promise<boolean> {
    if (!this.fileChunks.has(fileId)) {
      this.fileChunks.set(fileId, {
        chunks: new Array(totalChunks),
        totalChunks,
        receivedChunks: 0,
        fileInfo,
      });
    }

    const chunkData = this.fileChunks.get(fileId)!;
    chunkData.chunks[index] = chunk;
    chunkData.receivedChunks++;

    if (chunkData.receivedChunks === totalChunks) {
      // All chunks received, assemble the file
      const completeFileData = new Uint8Array(fileInfo.size);
      let offset = 0;
      for (const chunk of chunkData.chunks) {
        completeFileData.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      // Store the complete file
      this.files.set(fileId, {
        data: completeFileData.buffer,
        size: fileInfo.size,
        type: fileInfo.type,
        name: fileInfo.name,
        thumbnail: fileInfo.thumbnail,
        icon: fileInfo.icon,
      });

      // Clean up chunks
      this.fileChunks.delete(fileId);
      this.broadcast();
      return true;
    }

    return false;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

// Export routes factory and types
export const createMessageHubRoutes = (hub: QrrAppDO) => {
  return new Hono<{ Variables: { do: QrrAppDO } }>()
    .use("*", async (c, next) => {
      c.set("do", hub);
      if (!hub.initialized) {
        console.log("Durable Object not initialized yet");
        const newResponse = new Response("Durable Object not initialized yet", {
          status: 503,
          statusText: "Service Unavailable",
        });
        return newResponse;
      } else {
        return await next();
      }
    })
    .post("/send", zValidator("json", sendSchema), async (c) => {
      const { message } = c.req.valid("json");
      await hub.send(message);
      return c.json({ success: true });
    })
    .get("/download/:fileId", async (c) => {
      const fileId = c.req.param("fileId");
      const file = hub.files.get(fileId);

      if (!file) {
        return c.json({ error: "File not found" }, 404);
      }

      const headers = new Headers({
        "Content-Type": file.type,
        "Content-Disposition": `attachment; filename="${file.name || "file"}"`,
        "Content-Length": file.data.byteLength.toString(),
      });

      return new Response(file.data, { headers });
    })
    .post("/upload", zValidator("form", uploadSchema), async (c) => {
      const { file: fileEntry, thumbnail, icon } = c.req.valid("form");

      const fileId = crypto.randomUUID();
      const name = fileEntry.name || "file";

      hub.files.set(fileId, {
        data: await fileEntry.arrayBuffer(),
        size: fileEntry.size,
        type: fileEntry.type,
        name,
        thumbnail: thumbnail || null,
        icon: icon || undefined,
      });

      hub.broadcast();

      return c.json({ fileId });
    })
    .post("/upload-chunk", zValidator("form", chunkUploadSchema), async (c) => {
      const { chunk, fileId, index, totalChunks, fileInfo } = c.req.valid("form");
      const chunkData = await chunk.arrayBuffer();
      const isComplete = await hub.handleChunkUpload(fileId, chunkData, index, totalChunks, fileInfo);

      return c.json({ 
        success: true, 
        isComplete,
        chunksReceived: hub.fileChunks.get(fileId)?.receivedChunks || 0,
      });
    })
    .get("/ws", async (c) => {
      const upgradeHeader = c.req.header("Upgrade");
      if (upgradeHeader?.toLowerCase() !== "websocket") {
        return c.text("Expected WebSocket upgrade", 426);
      }
      const sessionHost = getCookie(c, "sessionHost") ?? "";
      return hub.handleWebSocketUpgrade(sessionHost);
    });
};

export type MessageHubRoutes = ReturnType<typeof createMessageHubRoutes>;
export default QrrAppDO;
