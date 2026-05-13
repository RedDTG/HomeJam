import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";

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
const rootDir = resolve(__dirname, "..");
loadEnvFile(join(rootDir, ".env"));

const publicDir = join(rootDir, "public");
const dataDir = join(rootDir, "data");
const mediaDir = join(rootDir, "media");
const dbPath = join(dataDir, "state.json");
const ytdlpPath = resolveConfiguredPath(process.env.YTDLP_PATH?.trim() || "yt-dlp");
const ffmpegPath = process.env.FFMPEG_PATH?.trim() ? resolveConfiguredPath(process.env.FFMPEG_PATH.trim()) : undefined;
const primaryColor = parseHexColor(process.env.PRIMARY_COLOR?.trim() || "#b8f6d0");
const primaryColorFromArtwork = parseBoolean(process.env.PRIMARY_COLOR_FROM_ARTWORK);

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

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/assets", express.static(publicDir));
app.use("/media", express.static(mediaDir, { acceptRanges: true }));
app.get("/favicon.ico", (_request, response) => response.status(204).end());

const server = app.listen(Number(process.env.PORT ?? 3000), () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3000;
  console.log(`HomeJam listening on http://localhost:${port}`);
});

const wss = new WebSocketServer({ server, path: "/ws" });
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

app.get("/", (_request, response) => response.redirect("/client"));
app.get(["/admin", "/client", "/visualizer"], (request, response) => {
  const page = request.path.slice(1);
  response.send(renderPage(page));
});

app.get("/api/state", (_request, response) => response.json(publicState()));

app.get("/api/search", async (request, response) => {
  const term = String(request.query.q ?? "").trim();
  if (term.length < 2) {
    response.json([]);
    return;
  }

  const params = new URLSearchParams({ term, media: "music", entity: "song", limit: "12", country: "FR" });
  const apiResponse = await fetch(`https://itunes.apple.com/search?${params.toString()}`);
  if (!apiResponse.ok) {
    response.status(502).json({ error: "iTunes search failed" });
    return;
  }
  const payload = (await apiResponse.json()) as { results?: ItunesResult[] };
  response.json((payload.results ?? []).filter((item) => item.trackName && item.artistName).map(toTrack));
});

app.post("/api/jam/start", (_request, response) => {
  state.running = true;
  promoteNextReadyTrack();
  persistAndBroadcast();
  response.json(publicState());
});

app.post("/api/jam/stop", (_request, response) => {
  state.running = false;
  persistAndBroadcast();
  response.json(publicState());
});

app.post("/api/queue", async (request, response) => {
  const track = parseTrack(request.body);
  if (!track) {
    response.status(400).json({ error: "Invalid track" });
    return;
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

  response.status(201).json(item);
});

app.post("/api/player/ended", (_request, response) => {
  state.current = null;
  promoteNextReadyTrack();
  persistAndBroadcast();
  response.json(publicState());
});

app.post("/api/player/skip", (_request, response) => {
  state.current = null;
  promoteNextReadyTrack();
  persistAndBroadcast();
  response.json(publicState());
});

app.delete("/api/queue/:id", (request, response) => {
  state.queue = state.queue.filter((item) => item.id !== request.params.id);
  persistAndBroadcast();
  response.status(204).end();
});

app.delete("/api/queue", (_request, response) => {
  state.queue = state.queue.filter((item) => item.status === "downloading");
  persistAndBroadcast();
  response.status(204).end();
});

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

function renderPage(page: string): string {
  const title = page === "admin" ? "HomeJam Admin" : page === "visualizer" ? "HomeJam Visualizer" : "HomeJam";
  const [red, green, blue] = primaryColor.rgb;
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body data-page="${page}" data-primary-color-from-artwork="${primaryColorFromArtwork}" style="--primary-color:${primaryColor.hex};--primary-color-rgb:${red}, ${green}, ${blue};">
  <main id="app"></main>
  <script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}

function parseHexColor(value: string): { hex: string; rgb: [number, number, number] } {
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return { hex: "#b8f6d0", rgb: [184, 246, 208] };
  const normalized = match[1].length === 3 ? match[1].split("").map((char) => `${char}${char}`).join("") : match[1];
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return { hex: `#${normalized.toLowerCase()}`, rgb: [red, green, blue] };
}

function parseBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
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
    process.env[key] = rawValue.replace(/^['\"]|['\"]$/g, "");
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
    if (client.readyState === client.OPEN) client.send(payload);
  }
}
