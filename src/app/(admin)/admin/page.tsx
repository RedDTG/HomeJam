"use client";

import { useEffect, useRef, useState } from "react";
import { Shell } from "../../../lib/Shell";
import { QueueList } from "../../../lib/QueueList";
import { useJamState } from "../../../lib/useJamState";
import { usePrimaryArtworkColor } from "../../../lib/usePrimaryColor";
import { placeholder, visualizerBarCount } from "../../../lib/constants";
import { label } from "../../../lib/helpers";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export default function AdminPage() {
  const { state, socketRef } = useJamState();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const broadcastFrameRef = useRef<number | null>(null);
  const currentAudioIdRef = useRef<string | null>(null);
  const [autoplayHint, setAutoplayHint] = useState("");

  usePrimaryArtworkColor(state.current?.track.artwork || "");

  function startVisualizer() {
    const audio = audioRef.current;
    if (!audio || !audio.currentSrc || audio.paused) return;
    const win = window as WebkitWindow;
    const AudioContextClass = window.AudioContext || win.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContextRef.current) {
      const ctx = new AudioContextClass();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.74;
      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }

    if (sourceAudioRef.current !== audio) {
      try {
        const source = audioContextRef.current.createMediaElementSource(audio);
        source.connect(analyserRef.current!);
        analyserRef.current!.connect(audioContextRef.current.destination);
      } catch {
        // Already connected for this element — ignore.
      }
      sourceAudioRef.current = audio;
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => undefined);
    }

    broadcastVisualizer();
  }

  function broadcastVisualizer() {
    if (broadcastFrameRef.current) cancelAnimationFrame(broadcastFrameRef.current);
    const send = () => {
      const analyser = analyserRef.current;
      const data = dataRef.current;
      const socket = socketRef.current;
      if (analyser && data && socket?.readyState === WebSocket.OPEN) {
        analyser.getByteFrequencyData(data);
        const levels = Array.from({ length: visualizerBarCount }, (_, index) => {
          const start = Math.floor((index * data.length) / visualizerBarCount);
          const end = Math.max(start + 1, Math.floor(((index + 1) * data.length) / visualizerBarCount));
          let total = 0;
          for (let cursor = start; cursor < end; cursor += 1) total += data[cursor];
          return Math.min(1, total / (end - start) / 255);
        });
        socket.send(JSON.stringify({ type: "visualizer", levels }));
      }
      broadcastFrameRef.current = requestAnimationFrame(send);
    };
    send();
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      fetch("/api/player/ended", { method: "POST" });
    };
    const onPlay = () => startVisualizer();
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      if (broadcastFrameRef.current) {
        cancelAnimationFrame(broadcastFrameRef.current);
        broadcastFrameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const current = state.current;
    if (!current?.track.localPath) {
      currentAudioIdRef.current = null;
      audio.removeAttribute("src");
      return;
    }
    if (currentAudioIdRef.current !== current.id) {
      currentAudioIdRef.current = current.id;
      audio.src = current.track.localPath;
      audio.load();
    }
    if (state.running) {
      audio
        .play()
        .then(() => startVisualizer())
        .catch(() => {
          setAutoplayHint(
            "Le navigateur bloque le premier demarrage automatique: autorise l'audio pour cette page, puis l'enchainement sera automatique.",
          );
        });
    } else {
      audio.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const current = state.current;
  const downloads = state.queue.filter((item) => item.status === "downloading" || item.status === "failed");

  return (
    <Shell page="admin" title="Admin">
      <section className="grid admin-grid">
        <article className="panel now">
          <div className="cover-wrap">
            <img src={current?.track.artwork || placeholder} alt="" />
          </div>
          <div>
            <p className={`status ${state.running ? "on" : "off"}`}>{state.running ? "Jam active" : "Jam arretee"}</p>
            <h2>{current?.track.title || "Aucun morceau"}</h2>
            <p>
              {current
                ? `${current.track.artist} - ${current.track.album}`
                : "Le prochain morceau pret partira automatiquement."}
            </p>
            <div className="controls">
              <button
                onClick={() => {
                  fetch(`/api/jam/${state.running ? "stop" : "start"}`, { method: "POST" });
                }}
              >
                {state.running ? "Arreter" : "Lancer"}
              </button>
              <button
                disabled={!current}
                onClick={() => {
                  fetch("/api/player/skip", { method: "POST" });
                }}
              >
                Passer
              </button>
              <button
                onClick={() => {
                  fetch("/api/queue", { method: "DELETE" });
                }}
              >
                Vider la file
              </button>
            </div>
            <audio id="player" ref={audioRef} controls preload="auto" crossOrigin="anonymous" />
            <p id="autoplayHint" className="hint">
              {autoplayHint}
            </p>
          </div>
        </article>
        <article className="panel">
          <div className="section-head">
            <p>Downloads</p>
            <span>yt-dlp</span>
          </div>
          {downloads.length ? (
            <div className="downloads">
              {downloads.map((item) => (
                <article key={item.id}>
                  <div className="line">
                    <strong>{item.track.title}</strong>
                    <span>{label(item)}</span>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${item.status === "failed" ? 100 : item.progress}%` }} />
                  </div>
                  {item.error ? <p className="error">{item.error}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty">Aucun telechargement actif.</p>
          )}
        </article>
        <article className="panel queue-panel">
          <div className="section-head">
            <p>Queue</p>
            <span>
              {state.queue.length} titre{state.queue.length > 1 ? "s" : ""}
            </span>
          </div>
          <QueueList
            items={state.queue}
            admin
            onRemove={(id) => {
              fetch(`/api/queue/${id}`, { method: "DELETE" });
            }}
          />
        </article>
      </section>
    </Shell>
  );
}
