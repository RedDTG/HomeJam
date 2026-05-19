"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Shell } from "../../../lib/Shell";
import { useJamState } from "../../../lib/useJamState";
import { usePrimaryArtworkColor } from "../../../lib/usePrimaryColor";
import { placeholder, visualizerBarCount } from "../../../lib/constants";

export default function VisualizerPage() {
  const levelsRef = useRef<number[]>([]);
  const waveRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const { state } = useJamState({
    onVisualizerMessage: (levels) => {
      levelsRef.current = levels.slice(0, visualizerBarCount);
    },
  });

  usePrimaryArtworkColor(state.current?.track.artwork || "");

  useEffect(() => {
    const wave = waveRef.current;
    if (!wave) return;
    const bars = Array.from(wave.querySelectorAll<HTMLSpanElement>("span"));
    if (!bars.length) return;
    const draw = () => {
      bars.forEach((bar, index) => {
        const level = Math.max(0.06, Number(levelsRef.current[index] || 0));
        bar.style.transform = `scaleY(${level})`;
        bar.style.opacity = String(0.34 + level * 0.66);
      });
      frameRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  const current = state.current;
  const track = current?.track;
  const artwork = track?.artwork || placeholder;
  const visualStyle = { "--ambient-art": `url('${artwork}')` } as CSSProperties;
  const visibleQueue = state.queue;

  return (
    <Shell page="visualizer" title="Visualizer">
      <section className="visual" style={visualStyle}>
        <article className="visual-main">
          <div className="visual-cover">
            <img src={artwork} alt={track ? `Pochette de ${track.album}` : "Pochette HomeJam"} />
          </div>
          <div className="visual-info">
            <h1>{track?.title || "En attente"}</h1>
            <div className="visual-meta">
              <span>{track?.artist || "HomeJam"}</span>
              <span>{track?.album || "En attente"}</span>
            </div>
          </div>
          <div className="wave" aria-hidden="true" ref={waveRef}>
            {Array.from({ length: visualizerBarCount }, (_, index) => (
              <span key={index} style={{ "--i": index } as CSSProperties} />
            ))}
          </div>
        </article>
        <aside className="panel glass visual-queue">
          <div className="section-head">
            <p>À suivre</p>
            <span>{state.queue.length}</span>
          </div>
          {visibleQueue.length ? (
            <div className="queue visual-next">
              {visibleQueue.map((item, index) => (
                <article key={item.id} className="queue-item">
                  <span className="queue-rank">{String(index + 1).padStart(2, "0")}</span>
                  <img src={item.track.artwork || placeholder} alt="" />
                  <div>
                    <strong>{item.track.title}</strong>
                    <span>{item.track.artist}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty">Aucun morceau en attente.</p>
          )}
        </aside>
      </section>
    </Shell>
  );
}
