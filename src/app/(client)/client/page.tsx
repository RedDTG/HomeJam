"use client";

import { useState, type FormEvent } from "react";
import { Shell } from "../../../lib/Shell";
import { QueueList } from "../../../lib/QueueList";
import { useJamState } from "../../../lib/useJamState";
import { usePrimaryArtworkColor } from "../../../lib/usePrimaryColor";
import { placeholder } from "../../../lib/constants";
import type { Track } from "../../../lib/types";

export default function ClientPage() {
  const { state } = useJamState();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);

  usePrimaryArtworkColor(state.current?.track.artwork || "");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
    setResults(await response.json());
  }

  async function addTrack(track: Track) {
    await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(track),
    });
  }

  return (
    <Shell page="client" title="Invite">
      <section className="grid two client-layout">
        <article className="panel search-panel">
          <div className="section-head">
            <p>Recherche</p>
            <span>iTunes metadata</span>
          </div>
          <form id="searchForm" className="search" onSubmit={onSubmit}>
            <input
              id="searchInput"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Titre, artiste, album"
              autoComplete="off"
            />
            <button>Go</button>
          </form>
          <div className="results">
            {results.length ? (
              results.map((track) => (
                <article key={track.id} className="track-card">
                  <img src={track.artwork || placeholder} alt="" />
                  <div>
                    <h3>{track.title}</h3>
                    <p>
                      {track.artist} - {track.album}
                    </p>
                  </div>
                  <button onClick={() => addTrack(track)}>Ajouter</button>
                </article>
              ))
            ) : (
              <p className="empty">Lance une recherche pour proposer un morceau.</p>
            )}
          </div>
        </article>
        <article className="panel compact">
          <div className="section-head">
            <p>Queue</p>
            <span>
              {state.queue.length} titre{state.queue.length > 1 ? "s" : ""}
            </span>
          </div>
          <QueueList items={state.queue} admin={false} />
        </article>
      </section>
    </Shell>
  );
}
