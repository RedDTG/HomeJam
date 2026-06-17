"use client";

import { useEffect, useRef, useState } from "react";
import type { JamState } from "./types";
import { initialJamState } from "./constants";

type Options = {
  onVisualizerMessage?: (levels: number[]) => void;
};

export function useJamState({ onVisualizerMessage }: Options = {}) {
  const [state, setState] = useState<JamState>(initialJamState);
  const socketRef = useRef<WebSocket | null>(null);
  const visualizerCallbackRef = useRef(onVisualizerMessage);
  visualizerCallbackRef.current = onVisualizerMessage;

  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadState() {
      try {
        const response = await fetch("/api/state");
        const data = (await response.json()) as JamState;
        if (!closed) setState(data);
      } catch {
        // ignore
      }
    }

    function connect() {
      if (closed) return;
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${location.host}/ws`);
      socketRef.current = socket;
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "state") setState(message.state);
          else if (message.type === "visualizer" && Array.isArray(message.levels)) {
            visualizerCallbackRef.current?.(message.levels);
          }
        } catch {
          // ignore
        }
      });
      socket.addEventListener("error", () => socket.close());
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (closed) return;
        reconnectTimer = setTimeout(connect, 1000);
      });
    }

    connect();
    loadState();
    const pollHandle = setInterval(() => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) loadState();
    }, 2000);

    return () => {
      closed = true;
      clearInterval(pollHandle);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  return { state, socketRef };
}
