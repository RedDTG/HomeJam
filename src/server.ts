import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize as normalizePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

type NextServer = {
  didWebSocketSetup?: boolean;
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  getUpgradeHandler(): (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;
  prepare(): Promise<void>;
};

type CreateNextServer = (options: { dev: boolean; dir: string }) => NextServer;

type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl?: string;
  durationMs?: number;
  itunesUrl?: string;
  localPath?: string;
};

type QueueStatus = "queued" | "downloading" | "ready" | "playing" | "failed";

type QueueItem = {
  id: string;
  track: Track;
  status: QueueStatus;
  requestedAt: number;
  progress: number;
  error?: string;
};

type JamState = {
  running: boolean;
  current: QueueItem | null;
  queue: QueueItem[];
  downloads: Record<string, number>;
  library: Record<string, string>;
};

type ItunesResult = {
  trackId?: number;
  collectionId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  trackViewUrl?: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const createNextServer = require("next") as CreateNextServer;
const rootDir = resolve(__dirname, "..");
loadEnvFile(join(rootDir, ".env"));

const publicDir = join(rootDir, "public");
const dataDir = join(rootDir, "data");
const mediaDir = join(rootDir, "media");
const dbPath = join(dataDir, "state.json");
const ytdlpPath = resolveConfiguredPath(process.env.YTDLP_PATH?.trim() || "yt-dlp");
const ffmpegPath = process.env.FFMPEG_PATH?.trim() ? resolveConfiguredPath(process.env.FFMPEG_PATH.trim()) : undefined;

mkdirSync(dataDir, { recursive: true });
mkdirSync(mediaDir, { recursive: true });

const initialState: JamState = {
  running: false,
  current: null,
  queue: [],
  downloads: {},
  library: {},
};

const state: JamState = loadState();
let lastVisualizerLevels: number[] = [];

const nextApp = createNextServer({ dev: process.env.NODE_ENV !== "production", dir: rootDir });
const nextHandler = nextApp.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", state: publicState() }));
  if (lastVisualizerLevels.length) socket.send(JSON.stringify({ type: "visualizer", levels: lastVisualizerLevels }));
  socket.on("message", (payload) => {
    const message = parseSocketMessage(payload.toString());
    if (message?.type !== "visualizer") return;
    lastVisualizerLevels = message.levels;
    broadcast(JSON.stringify(message));
  });
});

await nextApp.prepare();
const nextUpgradeHandler = nextApp.getUpgradeHandler();
nextApp.didWebSocketSetup = true;

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      response.statusCode = 400;
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (await handleRequest(request, response, url)) return;
    await nextHandler(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: "Internal server error" });
    else response.end();
  }
});

server.on("upgrade", (request, socket, head) => {
  if (!request.url) {
    socket.destroy();
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws") {
    nextUpgradeHandler(request, socket, head).catch(() => socket.destroy());
    return;
  }
  wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3000;
  console.log(`HomeJam listening on http://localhost:${port}`);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(302, { Location: "/client" });
    response.end();
    return true;
  }
  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    response.statusCode = 204;
    response.end();
    return true;
  }
  if (request.method === "GET" && url.pathname.startsWith("/assets/")) return serveFile(response, publicDir, url.pathname.slice("/assets/".length));
  if (request.method === "GET" && url.pathname.startsWith("/media/")) return serveFile(response, mediaDir, url.pathname.slice("/media/".length), request.headers.range);
  if (url.pathname.startsWith("/api/")) return handleApi(request, response, url);
  return false;
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, publicState());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/search") {
    const term = String(url.searchParams.get("q") ?? "").trim();
    if (term.length < 2) {
      sendJson(response, 200, []);
      return true;
    }

    const params = new URLSearchParams({ term, media: "music", entity: "song", limit: "12", country: "FR" });
    const apiResponse = await fetch(`https://itunes.apple.com/search?${params.toString()}`);
    if (!apiResponse.ok) {
      sendJson(response, 502, { error: "iTunes search failed" });
      return true;
    }
    const payload = (await apiResponse.json()) as { results?: ItunesResult[] };
    sendJson(response, 200, (payload.results ?? []).filter((item) => item.trackName && item.artistName).map(toTrack));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/jam/start") {
    state.running = true;
    promoteNextReadyTrack();
    persistAndBroadcast();
    sendJson(response, 200, publicState());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/jam/stop") {
    state.running = false;
    persistAndBroadcast();
    sendJson(response, 200, publicState());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/queue") {
    const body = await readJsonBody(request);
    if (body === tooLargeBody) {
      sendJson(response, 413, { error: "Payload too large" });
      return true;
    }
    const track = parseTrack(body);
    if (!track) {
      sendJson(response, 400, { error: "Invalid track" });
      return true;
    }

    const libraryKey = getLibraryKey(track);
    const item: QueueItem = {
      id: randomUUID(),
      track: { ...track, localPath: state.library[libraryKey] },
      status: state.library[libraryKey] ? "ready" : "downloading",
      requestedAt: Date.now(),
      progress: state.library[libraryKey] ? 100 : 0,
    };

    state.queue.push(item);
    persistAndBroadcast();

    if (item.status === "ready") {
      promoteNextReadyTrack();
      persistAndBroadcast();
    } else {
      downloadTrack(item, libraryKey).catch((error: unknown) => failDownload(item, error));
    }

    sendJson(response, 201, item);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/player/ended") {
    state.current = null;
    promoteNextReadyTrack();
    persistAndBroadcast();
    sendJson(response, 200, publicState());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/player/skip") {
    state.current = null;
    promoteNextReadyTrack();
    persistAndBroadcast();
    sendJson(response, 200, publicState());
    return true;
  }

  const queueItemMatch = url.pathname.match(/^\/api\/queue\/([^/]+)$/);
  if (request.method === "DELETE" && queueItemMatch) {
    state.queue = state.queue.filter((item) => item.id !== queueItemMatch[1]);
    persistAndBroadcast();
    response.statusCode = 204;
    response.end();
    return true;
  }

  if (request.method === "DELETE" && url.pathname === "/api/queue") {
    state.queue = state.queue.filter((item) => item.status === "downloading");
    persistAndBroadcast();
    response.statusCode = 204;
    response.end();
    return true;
  }

  response.statusCode = 404;
  response.end();
  return true;
}

function serveFile(response: ServerResponse, baseDir: string, pathPart: string, range?: string): boolean {
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathPart);
  } catch {
    response.statusCode = 400;
    response.end();
    return true;
  }
  const filePath = resolve(baseDir, normalizePath(relativePath));
  if (!isPathInside(filePath, baseDir) || !existsSync(filePath)) {
    response.statusCode = 404;
    response.end();
    return true;
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    response.statusCode = 404;
    response.end();
    return true;
  }

  const headers: Record<string, string | number> = {
    "Content-Type": contentType(filePath),
    "Content-Length": stats.size,
  };

  if (!range) {
    response.writeHead(200, headers);
    createReadStream(filePath).pipe(response);
    return true;
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
    response.end();
    return true;
  }

  const suffixLength = !match[1] && match[2] ? Number(match[2]) : undefined;
  const start = suffixLength ? Math.max(0, stats.size - suffixLength) : match[1] ? Number(match[1]) : 0;
  const end = suffixLength ? stats.size - 1 : match[2] ? Number(match[2]) : stats.size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end >= stats.size) {
    response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
    response.end();
    return true;
  }

  response.writeHead(206, {
    ...headers,
    "Accept-Ranges": "bytes",
    "Content-Range": `bytes ${start}-${end}/${stats.size}`,
    "Content-Length": end - start + 1,
  });
  createReadStream(filePath, { start, end }).pipe(response);
  return true;
}

function isPathInside(filePath: string, baseDir: string): boolean {
  const base = resolve(baseDir);
  return filePath === base || filePath.startsWith(`${base}${sep}`);
}

function contentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".webm") return "audio/webm";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".wav") return "audio/wav";
  return "application/octet-stream";
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

const tooLargeBody = Symbol("tooLargeBody");

function readJsonBody(request: IncomingMessage): Promise<unknown | typeof tooLargeBody> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let resolved = false;
    request.on("data", (chunk: Buffer) => {
      if (resolved) return;
      size += chunk.length;
      if (size > 1024 * 1024) {
        resolved = true;
        resolvePromise(tooLargeBody);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (resolved) return;
      resolved = true;
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        resolvePromise(null);
      }
    });
    request.on("error", () => {
      if (resolved) return;
      resolved = true;
      resolvePromise(null);
    });
  });
}

function loadState(): JamState {
  if (!existsSync(dbPath)) return { ...initialState };
  try {
    const parsed = JSON.parse(readFileSync(dbPath, "utf8")) as JamState;
    return {
      running: false,
      current: null,
      queue: (parsed.queue ?? []).filter((item) => item.status !== "downloading").map((item) => ({ ...item, status: item.status === "playing" ? "ready" : item.status })),
      downloads: {},
      library: parsed.library ?? {},
    };
  } catch {
    return { ...initialState };
  }
}

function toTrack(item: ItunesResult): Track {
  const baseId = item.trackId ?? item.collectionId ?? `${item.artistName}-${item.trackName}`;
  return {
    id: String(baseId),
    title: item.trackName ?? "Titre inconnu",
    artist: item.artistName ?? "Artiste inconnu",
    album: item.collectionName ?? "Album inconnu",
    artwork: (item.artworkUrl100 ?? "").replace("100x100bb", "600x600bb"),
    previewUrl: item.previewUrl,
    durationMs: item.trackTimeMillis,
    itunesUrl: item.trackViewUrl,
  };
}

function parseTrack(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Track>;
  if (!candidate.id || !candidate.title || !candidate.artist || !candidate.album || !candidate.artwork) return null;
  return {
    id: String(candidate.id),
    title: String(candidate.title),
    artist: String(candidate.artist),
    album: String(candidate.album),
    artwork: String(candidate.artwork),
    previewUrl: candidate.previewUrl ? String(candidate.previewUrl) : undefined,
    durationMs: typeof candidate.durationMs === "number" ? candidate.durationMs : undefined,
    itunesUrl: candidate.itunesUrl ? String(candidate.itunesUrl) : undefined,
  };
}

async function downloadTrack(item: QueueItem, libraryKey: string): Promise<void> {
  const safeId = createHash("sha1").update(libraryKey).digest("hex").slice(0, 16);
  const outputTemplate = join(mediaDir, `${safeId}.%(ext)s`);
  const query = `ytsearch10:${item.track.artist} - ${item.track.title} official audio topic`;
  const args = [
    "--newline",
    "--ignore-errors",
    "--max-downloads",
    "1",
    "--no-playlist",
    "--age-limit",
    "17",
    "--match-filter",
    "title !~= '(?i)(official video|music video|video clip|clip officiel|lyrics|paroles|live|cover|karaoke)'",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outputTemplate,
    query,
  ];

  if (ffmpegPath) {
    args.splice(1, 0, "--ffmpeg-location", ffmpegPath);
  }

  await runYtDlp(args, item);
  const downloaded = readdirSync(mediaDir).find((file) => file.startsWith(`${safeId}.`) && extname(file));
  if (!downloaded) throw new Error("yt-dlp did not produce an audio file");
  const finalPath = join(mediaDir, `${safeId}${extname(downloaded)}`);
  const currentPath = join(mediaDir, downloaded);
  if (currentPath !== finalPath) renameSync(currentPath, finalPath);

  item.track.localPath = `/media/${safeId}${extname(downloaded)}`;
  item.status = "ready";
  item.progress = 100;
  state.library[libraryKey] = item.track.localPath;
  delete state.downloads[item.id];
  promoteNextReadyTrack();
  persistAndBroadcast();
}

function runYtDlp(args: string[], item: QueueItem): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const process = spawn(ytdlpPath, args, { windowsHide: true });
    let stderr = "";

    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      const match = chunk.match(/\[download]\s+([0-9.]+)%/);
      if (!match) return;
      const progress = Number(match[1]);
      if (!Number.isFinite(progress)) return;
      item.progress = Math.max(item.progress, Math.min(99, progress));
      state.downloads[item.id] = item.progress;
      persistAndBroadcast();
    });
    process.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    process.on("error", rejectPromise);
    process.on("close", (code) => {
      if (code === 0 || code === 101) resolvePromise();
      else rejectPromise(new Error(stderr.trim() || `yt-dlp exited with code ${code ?? "unknown"}`));
    });
  });
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = rawValue.replace(/^[\'"]|[\'"]$/g, "");
  }
}

function resolveConfiguredPath(path: string): string {
  if (isAbsolute(path) || path === "yt-dlp") return path;
  return resolve(rootDir, path);
}

function failDownload(item: QueueItem, error: unknown): void {
  item.status = "failed";
  item.error = error instanceof Error ? error.message : "Download failed";
  delete state.downloads[item.id];
  persistAndBroadcast();
}

function promoteNextReadyTrack(): void {
  if (!state.running || state.current) return;
  const index = state.queue.findIndex((item) => item.status === "ready" && item.track.localPath);
  if (index === -1) return;
  const [next] = state.queue.splice(index, 1);
  next.status = "playing";
  state.current = next;
}

function getLibraryKey(track: Track): string {
  return `${normalize(track.artist)}__${normalize(track.title)}`;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function publicState(): JamState {
  return state;
}

function parseSocketMessage(value: string): { type: "visualizer"; levels: number[] } | null {
  try {
    const parsed = JSON.parse(value) as { type?: unknown; levels?: unknown };
    if (parsed.type !== "visualizer" || !Array.isArray(parsed.levels)) return null;
    return { type: "visualizer", levels: parsed.levels.map(Number).filter(Number.isFinite).slice(0, 64) };
  } catch {
    return null;
  }
}

function persistAndBroadcast(): void {
  writeFileSync(dbPath, JSON.stringify(state, null, 2));
  broadcast(JSON.stringify({ type: "state", state: publicState() }));
}

function broadcast(payload: string): void {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}
