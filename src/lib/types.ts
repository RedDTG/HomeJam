export type Track = {
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

export type QueueStatus = "queued" | "downloading" | "ready" | "playing" | "failed";

export type QueueItem = {
  id: string;
  track: Track;
  status: QueueStatus;
  requestedAt: number;
  progress: number;
  error?: string;
};

export type JamState = {
  running: boolean;
  current: QueueItem | null;
  queue: QueueItem[];
  downloads: Record<string, number>;
  library: Record<string, string>;
};
