import type { QueueItem } from "./types";

export function label(item: QueueItem): string {
  if (item.status === "downloading") return `telechargement ${Math.round(item.progress)}%`;
  if (item.status === "ready") return "pret";
  if (item.status === "playing") return "en lecture";
  if (item.status === "failed") return "echec";
  return "en file";
}
