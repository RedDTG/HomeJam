const app = document.querySelector("#app");
const page = document.body.dataset.page || "client";

let state = { running: false, current: null, queue: [], downloads: {}, library: {} };
let results = [];
let query = "";
let audio;
let currentAudioId = null;

const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'%3E%3Crect width='600' height='600' fill='%2316161d'/%3E%3Cpath d='M395 145v236a78 78 0 1 1-32-63V218l-164 33v163a78 78 0 1 1-32-63V203z' fill='%2372f2a1'/%3E%3C/svg%3E";

connect();
loadState();

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      state = message.state;
      render();
      syncAudio();
    }
  });
  socket.addEventListener("close", () => setTimeout(connect, 1000));
}

async function loadState() {
  const response = await fetch("/api/state");
  state = await response.json();
  render();
  syncAudio();
}

function render() {
  if (page === "admin") renderAdmin();
  else if (page === "visualizer") renderVisualizer();
  else renderClient();
}

function shell(title, subtitle, content) {
  app.innerHTML = `
    <section class="shell shell-${page}">
      <header class="topline">
        <span class="brand">HomeJam</span>
        <span>${title}</span>
      </header>
      ${content}
    </section>`;
}

function renderClient() {
  shell(
    "Invite",
    "",
    `<section class="grid two client-layout">
      <article class="panel search-panel">
        <div class="section-head">
          <p>Recherche</p>
          <span>iTunes metadata</span>
        </div>
        <form id="searchForm" class="search">
          <input id="searchInput" value="${escapeHtml(query)}" placeholder="Titre, artiste, album" autocomplete="off">
          <button>Go</button>
        </form>
        <div class="results">${results.map(resultCard).join("") || empty("Lance une recherche pour proposer un morceau.")}</div>
      </article>
      <article class="panel compact">
        <div class="section-head"><p>Queue</p><span>${state.queue.length} titre${state.queue.length > 1 ? "s" : ""}</span></div>
        ${queueList(false)}
      </article>
    </section>`
  );
  bindSearch();
  app.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", async () => {
      const track = results[Number(button.dataset.add)];
      await fetch("/api/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(track) });
    });
  });
}

function renderAdmin() {
  const current = state.current;
  const existingAudio = audio;
  const shouldKeepAudio = existingAudio && currentAudioId === current?.id;
  shell(
    "Admin",
    "",
    `<section class="grid admin-grid">
      <article class="panel now">
        <div class="cover-wrap"><img src="${current?.track.artwork || placeholder}" alt=""></div>
        <div>
          <p class="status ${state.running ? "on" : "off"}">${state.running ? "Jam active" : "Jam arretee"}</p>
          <h2>${escapeHtml(current?.track.title || "Aucun morceau")}</h2>
          <p>${escapeHtml(current ? `${current.track.artist} - ${current.track.album}` : "Le prochain morceau pret partira automatiquement.")}</p>
          <div class="controls">
            <button id="toggleJam">${state.running ? "Arreter" : "Lancer"}</button>
            <button id="skipTrack" ${current ? "" : "disabled"}>Passer</button>
            <button id="clearQueue">Vider la file</button>
          </div>
          <audio id="player" controls preload="auto" crossorigin="anonymous"></audio>
          <p id="autoplayHint" class="hint"></p>
        </div>
      </article>
      <article class="panel">
        <div class="section-head"><p>Downloads</p><span>yt-dlp</span></div>
        ${downloadList()}
      </article>
      <article class="panel queue-panel">
        <div class="section-head"><p>Queue</p><span>${state.queue.length} titre${state.queue.length > 1 ? "s" : ""}</span></div>
        ${queueList(true)}
      </article>
    </section>`
  );
  const renderedAudio = app.querySelector("#player");
  if (shouldKeepAudio) {
    renderedAudio.replaceWith(existingAudio);
    audio = existingAudio;
  } else {
    audio = renderedAudio;
    audio.addEventListener("ended", () => fetch("/api/player/ended", { method: "POST" }));
  }
  app.querySelector("#toggleJam").addEventListener("click", () => fetch(`/api/jam/${state.running ? "stop" : "start"}`, { method: "POST" }));
  app.querySelector("#skipTrack").addEventListener("click", () => fetch("/api/player/skip", { method: "POST" }));
  app.querySelector("#clearQueue").addEventListener("click", () => fetch("/api/queue", { method: "DELETE" }));
  app.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => fetch(`/api/queue/${button.dataset.remove}`, { method: "DELETE" })));
}

function renderVisualizer() {
  const current = state.current;
  shell(
    "Visualizer",
    "",
    `<section class="visual">
      <article class="visual-main">
        <div class="visual-cover"><img src="${current?.track.artwork || placeholder}" alt=""></div>
        <div class="visual-info">
          <p>${escapeHtml(current?.track.artist || "HomeJam")}</p>
          <h1>${escapeHtml(current?.track.title || "En attente")}</h1>
          <span>${escapeHtml(current?.track.album || "La prochaine musique apparaitra ici")}</span>
        </div>
        ${waveform()}
      </article>
      <aside class="panel glass visual-queue">
        <div class="section-head"><p>A suivre</p><span>${state.queue.length}</span></div>
        ${queueList(false)}
      </aside>
    </section>`
  );
}

function waveform() {
  return `<div class="wave" aria-hidden="true">${Array.from({ length: 32 }, (_, index) => `<span style="--i:${index}"></span>`).join("")}</div>`;
}

function bindSearch() {
  const form = app.querySelector("#searchForm");
  const input = app.querySelector("#searchInput");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    query = input.value.trim();
    if (query.length < 2) return;
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    results = await response.json();
    render();
  });
}

function syncAudio() {
  if (page !== "admin" || !audio) return;
  const current = state.current;
  if (!current?.track.localPath) {
    currentAudioId = null;
    audio.removeAttribute("src");
    return;
  }
  if (currentAudioId !== current.id) {
    currentAudioId = current.id;
    audio.src = current.track.localPath;
    audio.load();
  }
  if (state.running) {
    audio.play().catch(() => {
      const hint = app.querySelector("#autoplayHint");
      if (hint) hint.textContent = "Le navigateur bloque le premier demarrage automatique: autorise l'audio pour cette page, puis l'enchainement sera automatique.";
    });
  } else {
    audio.pause();
  }
}

function resultCard(track, index) {
  return `<article class="track-card">
    <img src="${track.artwork || placeholder}" alt="">
    <div>
      <h3>${escapeHtml(track.title)}</h3>
      <p>${escapeHtml(track.artist)} - ${escapeHtml(track.album)}</p>
    </div>
    <button data-add="${index}">Ajouter</button>
  </article>`;
}

function queueList(admin) {
  const items = state.queue;
  if (!items.length) return empty("Aucun morceau en attente.");
  return `<div class="queue">${items.map((item) => `<article class="queue-item">
    <img src="${item.track.artwork || placeholder}" alt="">
    <div>
      <strong>${escapeHtml(item.track.title)}</strong>
      <span>${escapeHtml(item.track.artist)} - ${label(item)}</span>
    </div>
    ${admin ? `<button class="ghost" data-remove="${item.id}">Retirer</button>` : ""}
  </article>`).join("")}</div>`;
}

function downloadList() {
  const items = state.queue.filter((item) => item.status === "downloading" || item.status === "failed");
  if (!items.length) return empty("Aucun telechargement actif.");
  return `<div class="downloads">${items.map((item) => `<article>
    <div class="line"><strong>${escapeHtml(item.track.title)}</strong><span>${label(item)}</span></div>
    <div class="bar"><span style="width:${item.status === "failed" ? 100 : item.progress}%"></span></div>
    ${item.error ? `<p class="error">${escapeHtml(item.error)}</p>` : ""}
  </article>`).join("")}</div>`;
}

function label(item) {
  if (item.status === "downloading") return `telechargement ${Math.round(item.progress)}%`;
  if (item.status === "ready") return "pret";
  if (item.status === "playing") return "en lecture";
  if (item.status === "failed") return "echec";
  return "en file";
}

function empty(text) {
  return `<p class="empty">${text}</p>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
