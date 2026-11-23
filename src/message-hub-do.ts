import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { DurableObject } from "cloudflare:workers";
import { getCookie } from "hono/cookie";

/**
 * Max total size of files kept in a single session (must match client limit).
 * Files live only in RAM; a Durable Object isolate has 128 MB in total, so we
 * leave headroom for the runtime, in-flight upload chunks and responses.
 */
export const MAX_TOTAL_SIZE = 80 * 1024 * 1024;
/** Incomplete uploads with no activity for this long stop reserving space */
const STALE_UPLOAD_MS = 1000 * 60 * 5;
/** Grace period used while host has the native file picker open */
const PICKER_HOLD_MS = 1000 * 60 * 5;

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

const fileInfoSchema = z.object({
  name: z.string().max(1024).default("file"),
  type: z.string().max(255).default(""),
  size: z.number().int().nonnegative(),
  thumbnail: z.string().max(200_000).nullable().optional(),
  icon: z.string().max(32).optional(),
});

/** Schema for chunk upload validation */
export const chunkUploadSchema = z.object({
  chunk: z.instanceof(Blob),
  fileId: z.uuid(),
  index: z.coerce.number().int().nonnegative(),
  totalChunks: z.coerce.number().int().positive().max(10_000),
  fileInfo: z.string().transform((val, ctx) => {
    try {
      return fileInfoSchema.parse(JSON.parse(val));
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid fileInfo" });
      return z.NEVER;
    }
  }),
});

type FileInfoInput = z.infer<typeof fileInfoSchema>;

/**
 * Connection metadata for WebSocket connections
 */
export interface Connection {
  role: "host" | "guest";
  ws: WebSocket;
}

/** Public file metadata broadcast to clients */
export interface FileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  thumbnail: string | null;
  icon?: string;
}

/** File kept in memory as the list of uploaded chunks (never concatenated) */
interface StoredFile {
  meta: FileMeta;
  totalChunks: number;
  chunks: (ArrayBuffer | undefined)[];
  received: number;
  complete: boolean;
  lastActivity: number;
}

class UploadError extends Error {
  constructor(message: string, public status: 400 | 409 | 413) {
    super(message);
  }
}

type Variables = {
  do: QrrAppDO;
};

/**
 * Encodes a filename for the Content-Disposition header (RFC 6266 / RFC 5987).
 * Header values must be Latin-1, so non-ASCII names (e.g. Polish letters) would
 * otherwise throw and make the download fail.
 */
const contentDisposition = (name: string): string => {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

/**
 * MessageHub Durable Object for handling WebSocket messaging and file transfers.
 *
 * Files are never written to disk – they only live in this object's memory and
 * disappear together with the session. To stay well below the 128 MB isolate
 * limit, files are kept as the list of uploaded chunks (no second copy made by
 * concatenating them) and downloads stream those chunks directly.
 */
export class QrrAppDO extends DurableObject {
  public app: Hono<{ Variables: Variables }>;
  public connections: Connection[] = [];
  public message = "";
  public files = new Map<string, StoredFile>();
  public initialized = false;
  public hostCode = Math.floor(Math.random() * 10000000)
    .toString()
    .padStart(8, "0");
  /** Mode of operation: "auto" | "send" | "receive" */
  public hostsMode = "auto";

  constructor(state: DurableObjectState, env: {}) {
    super(state, env);

    // Only session flags are (temporarily) persisted while the host has the
    // file picker open – never file contents.
    this.ctx.blockConcurrencyWhile(async () => {
      this.initialized = (await this.ctx.storage.get("initialized")) || false;
      this.hostCode = (await this.ctx.storage.get("hostCode")) || this.hostCode;
      this.hostsMode = (await this.ctx.storage.get("hostsMode")) || "auto";
    });

    this.app = createMessageHubRoutes(this);
  }

  public setInitialized(): string {
    this.files.clear();
    this.message = "";
    this.hostsMode = "auto";
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

  public listFiles(): FileMeta[] {
    const list: FileMeta[] = [];
    for (const file of this.files.values()) {
      if (file.complete) list.push(file.meta);
    }
    return list;
  }

  public getFile(fileId: string): StoredFile | undefined {
    return this.files.get(fileId);
  }

  public broadcast(code: number = 200, statusMessage: string = "OK"): void {
    if (this.connections.length === 0) return;
    // File list is identical for everyone – serialize it once
    const files = JSON.stringify(this.listFiles());
    const message = JSON.stringify(this.message);
    const status = JSON.stringify({ code, message: statusMessage });

    for (const connection of [...this.connections]) {
      const data = `{"status":${status},"role":${JSON.stringify(connection.role)},"mode":${JSON.stringify(
        this.getConnectionMode(connection)
      )},"message":${message},"files":${files}}`;
      try {
        connection.ws.send(data);
      } catch {
        this.connections = this.connections.filter((c) => c !== connection);
      }
    }
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

    const connection: Connection = {
      role: sessionHost === this.hostCode ? "host" : "guest",
      ws: server,
    };
    this.connections.push(connection);

    server.addEventListener("message", (event) => {
      this.webSocketMessage(server, event.data as string);
    });

    const onClose = () => {
      this.connections = this.connections.filter((conn) => conn.ws !== server);
      try {
        server.close(1000, "Connection closed by client");
      } catch {
        // already closed
      }
    };
    server.addEventListener("close", onClose);
    server.addEventListener("error", onClose);

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
            if (["auto", "send", "receive"].includes(parsedMessage.mode)) {
              this.hostsMode = parsedMessage.mode;
            } else {
              console.error("Unknown mode:", parsedMessage.mode);
            }
          }
          break;

        case "pickerHold":
          // Host opens the native file picker – mobile browsers often drop the
          // socket, so keep the session flags in case the object gets evicted.
          if (connection.role === "host") {
            await this.ctx.storage.put({
              initialized: this.initialized,
              hostCode: this.hostCode,
              hostsMode: this.hostsMode,
            });
            await this.ctx.storage.setAlarm(Date.now() + PICKER_HOLD_MS);
          } else {
            ws.send("Only host can hold");
          }
          break;

        case "pickerRelease":
          if (connection.role === "host") {
            await this.ctx.storage.deleteAll();
            await this.ctx.storage.deleteAlarm();
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

  /** Bytes used/reserved by files (abandoned incomplete uploads are dropped) */
  private usedBytes(): number {
    const now = Date.now();
    let total = 0;
    for (const [id, file] of this.files) {
      if (!file.complete && now - file.lastActivity > STALE_UPLOAD_MS) {
        this.files.delete(id);
        continue;
      }
      total += file.meta.size;
    }
    return total;
  }

  /**
   * Stores one chunk of a file. Idempotent – a retried chunk simply replaces
   * the previous copy, so retries can never corrupt or prematurely finish a file.
   */
  handleChunkUpload(
    fileId: string,
    chunk: ArrayBuffer,
    index: number,
    totalChunks: number,
    fileInfo: FileInfoInput
  ): { isComplete: boolean; chunksReceived: number } {
    if (index >= totalChunks) {
      throw new UploadError("Chunk index out of range", 400);
    }

    let file = this.files.get(fileId);
    if (file?.complete) {
      return { isComplete: true, chunksReceived: file.totalChunks };
    }

    if (!file) {
      if (this.usedBytes() + fileInfo.size > MAX_TOTAL_SIZE) {
        throw new UploadError("File size limit exceeded", 413);
      }
      file = {
        meta: {
          id: fileId,
          name: fileInfo.name || "file",
          type: fileInfo.type || "",
          size: fileInfo.size,
          thumbnail: fileInfo.thumbnail ?? null,
          icon: fileInfo.icon,
        },
        totalChunks,
        chunks: new Array(totalChunks),
        received: 0,
        complete: false,
        lastActivity: Date.now(),
      };
      this.files.set(fileId, file);
    } else if (file.totalChunks !== totalChunks || file.meta.size !== fileInfo.size) {
      throw new UploadError("File metadata mismatch", 409);
    }

    if (file.chunks[index] === undefined) file.received++;
    file.chunks[index] = chunk;
    file.lastActivity = Date.now();

    if (file.received < totalChunks) {
      return { isComplete: false, chunksReceived: file.received };
    }

    const storedBytes = file.chunks.reduce((acc, c) => acc + (c?.byteLength ?? 0), 0);
    if (storedBytes !== file.meta.size) {
      // Something went wrong – drop the file so the client can retry cleanly
      this.files.delete(fileId);
      throw new UploadError("File size mismatch", 409);
    }

    file.complete = true;
    this.broadcast();
    return { isComplete: true, chunksReceived: file.received };
  }

  /**
   * Streams a file straight from its in-memory chunks – no copy of the whole
   * file is made, no matter how many people download it at the same time.
   */
  public streamFile(file: StoredFile): ReadableStream<Uint8Array> {
    const chunks = file.chunks;
    let i = 0;
    const source = {
      // Non-standard workerd option: lets the runtime send Content-Length,
      // so browsers can show download progress.
      expectedLength: file.meta.size,
      pull(controller: ReadableStreamDefaultController<Uint8Array>) {
        // Skip empty chunks so pull() always enqueues data or closes
        while (i < chunks.length) {
          const chunk = chunks[i++];
          if (chunk && chunk.byteLength > 0) {
            controller.enqueue(new Uint8Array(chunk));
            return;
          }
        }
        controller.close();
      },
    };
    return new ReadableStream<Uint8Array>(source);
  }

  async alarm(): Promise<void> {
    // Picker hold expired – drop the persisted session flags
    await this.ctx.storage.deleteAll();
  }
}

// Export routes factory and types
export const createMessageHubRoutes = (hub: QrrAppDO) => {
  return new Hono<{ Variables: { do: QrrAppDO } }>()
    .use("*", async (c, next) => {
      c.set("do", hub);
      if (!hub.initialized) {
        return new Response("Durable Object not initialized yet", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }
      return await next();
    })
    .post("/send", zValidator("json", sendSchema), async (c) => {
      const { message } = c.req.valid("json");
      await hub.send(message);
      return c.json({ success: true });
    })
    .get("/download/:fileId", (c) => {
      const file = hub.getFile(c.req.param("fileId"));

      if (!file || !file.complete) {
        return c.json({ error: "File not found" }, 404);
      }

      return new Response(hub.streamFile(file), {
        headers: {
          "Content-Type": file.meta.type || "application/octet-stream",
          "Content-Disposition": contentDisposition(file.meta.name || "file"),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    })
    .post("/upload", zValidator("form", uploadSchema), async (c) => {
      // Kept for older cached clients – handled the same way as chunked uploads
      const { file, thumbnail, icon } = c.req.valid("form");
      const fileId = crypto.randomUUID();
      try {
        hub.handleChunkUpload(fileId, await file.arrayBuffer(), 0, 1, {
          name: file.name || "file",
          type: file.type,
          size: file.size,
          thumbnail: thumbnail || null,
          icon,
        });
      } catch (e) {
        if (e instanceof UploadError) return c.json({ error: e.message }, e.status);
        throw e;
      }
      return c.json({ fileId });
    })
    .post("/upload-chunk", zValidator("form", chunkUploadSchema), async (c) => {
      const { chunk, fileId, index, totalChunks, fileInfo } = c.req.valid("form");
      try {
        const result = hub.handleChunkUpload(
          fileId,
          await chunk.arrayBuffer(),
          index,
          totalChunks,
          fileInfo
        );
        return c.json({ success: true, ...result });
      } catch (e) {
        if (e instanceof UploadError) {
          return c.json({ success: false, error: e.message }, e.status);
        }
        throw e;
      }
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
