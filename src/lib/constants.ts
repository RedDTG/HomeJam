import type { JamState } from "./types";

export const placeholder =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'%3E%3Crect width='600' height='600' fill='%2316161d'/%3E%3Cpath d='M395 145v236a78 78 0 1 1-32-63V218l-164 33v163a78 78 0 1 1-32-63V203z' fill='%2372f2a1'/%3E%3C/svg%3E";

export const visualizerBarCount = 28;

export const initialJamState: JamState = {
  running: false,
  current: null,
  queue: [],
  downloads: {},
  library: {},
};
