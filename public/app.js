const app = document.querySelector("#app");
const page = document.body.dataset.page || "client";

let state = { running: false, current: null, queue: [], downloads: {}, library: {} };
let results = [];
let query = "";
let audio;
let socket;
let currentAudioId = null;
let adminAudioContext;
let adminAnalyser;
let adminData;
let adminSourceAudio;
let adminBroadcastFrame;
let visualLevels = [];
let visualFrame;
let primaryArtwork = "";
const primaryColorFromArtwork = document.body.dataset.primaryColorFromArtwork === "true";

const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'%3E%3Crect width='600' height='600' fill='%2316161d'/%3E%3Cpath d='M395 145v236a78 78 0 1 1-32-63V218l-164 33v163a78 78 0 1 1-32-63V203z' fill='%2372f2a1'/%3E%3C/svg%3E";
const visualizerBarCount = 32;

connect();
loadState();

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      state = message.state;
      applyArtworkPrimaryColor(state.current?.track.artwork || "");
      render();
      syncAudio();
    } else if (message.type === "visualizer") {
      visualLevels = Array.isArray(message.levels) ? message.levels : [];
    }
  });
  socket.addEventListener("open", startAdminVisualizer);
  socket.addEventListener("close", () => setTimeout(connect, 1000));
}

async function loadState() {
  const response = await fetch("/api/state");
  state = await response.json();
  applyArtworkPrimaryColor(state.current?.track.artwork || "");
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
  app.querySelector("#toggleJam").addEventListener("click", () => {
    fetch(`/api/jam/${state.running ? "stop" : "start"}`, { method: "POST" });
  });
  app.querySelector("#skipTrack").addEventListener("click", () => fetch("/api/player/skip", { method: "POST" }));
  app.querySelector("#clearQueue").addEventListener("click", () => fetch("/api/queue", { method: "DELETE" }));
  app.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => fetch(`/api/queue/${button.dataset.remove}`, { method: "DELETE" })));
  audio.addEventListener("play", startAdminVisualizer);
}

function renderVisualizer() {
  const current = state.current;
  const track = current?.track;
  shell(
    "Visualizer",
    "",
    `<section class="visual" style="--ambient-art:url('${track?.artwork || placeholder}')">
      <article class="visual-main">
        <div class="visual-cover">
          <img src="${track?.artwork || placeholder}" alt="${track ? `Pochette de ${escapeHtml(track.album)}` : "Pochette HomeJam"}">
        </div>
        <div class="visual-info">
          <h1>${escapeHtml(track?.title || "En attente")}</h1>
          <div class="visual-meta">
            <span>${escapeHtml(track?.artist || "HomeJam")}</span>
            <span>${escapeHtml(track?.album || "En attente")}</span>
          </div>
        </div>
        ${waveform()}
      </article>
      <aside class="panel glass visual-queue">
        <div class="section-head"><p>À suivre</p><span>${state.queue.length}</span></div>
        ${visualQueueList()}
      </aside>
    </section>`
  );
  drawVisualizer();
}

function waveform() {
  return `<div class="wave" aria-hidden="true">${Array.from({ length: visualizerBarCount }, (_, index) => `<span style="--i:${index}"></span>`).join("")}</div>`;
}

function visualQueueList() {
  const items = state.queue;
  if (!items.length) return empty("Aucun morceau en attente.");
  return `<div class="queue visual-next">${items.map((item, index) => `<article class="queue-item">
    <span class="queue-rank">${String(index + 1).padStart(2, "0")}</span>
    <img src="${item.track.artwork || placeholder}" alt="">
    <div>
      <strong>${escapeHtml(item.track.title)}</strong>
      <span>${escapeHtml(item.track.artist)}</span>
    </div>
  </article>`).join("")}</div>`;
}

function startAdminVisualizer() {
  if (page !== "admin" || !audio) return;
  if (!audio.currentSrc || audio.paused) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  if (!adminAudioContext) {
    adminAudioContext = new AudioContextClass();
    adminAnalyser = adminAudioContext.createAnalyser();
    adminAnalyser.fftSize = 128;
    adminAnalyser.smoothingTimeConstant = 0.74;
    adminData = new Uint8Array(adminAnalyser.frequencyBinCount);
  }

  if (adminSourceAudio !== audio) {
    const source = adminAudioContext.createMediaElementSource(audio);
    source.connect(adminAnalyser);
    adminAnalyser.connect(adminAudioContext.destination);
    adminSourceAudio = audio;
  }

  if (adminAudioContext.state === "suspended") adminAudioContext.resume().catch(() => undefined);
  broadcastVisualizer();
}

function broadcastVisualizer() {
  if (adminBroadcastFrame) cancelAnimationFrame(adminBroadcastFrame);
  const send = () => {
    if (adminAnalyser && adminData && socket?.readyState === WebSocket.OPEN) {
      adminAnalyser.getByteFrequencyData(adminData);
      const levels = Array.from({ length: visualizerBarCount }, (_, index) => {
        const start = Math.floor(index * adminData.length / visualizerBarCount);
        const end = Math.max(start + 1, Math.floor((index + 1) * adminData.length / visualizerBarCount));
        let total = 0;
        for (let cursor = start; cursor < end; cursor += 1) total += adminData[cursor];
        return Math.min(1, total / (end - start) / 255);
      });
      socket.send(JSON.stringify({ type: "visualizer", levels }));
    }
    adminBroadcastFrame = requestAnimationFrame(send);
  };
  send();
}

function drawVisualizer() {
  if (visualFrame) cancelAnimationFrame(visualFrame);
  const bars = Array.from(app.querySelectorAll(".wave span"));
  if (!bars.length) return;

  const draw = () => {
    bars.forEach((bar, index) => {
      const level = Math.max(0.06, Number(visualLevels[index] || 0));
      bar.style.transform = `scaleY(${level})`;
      bar.style.opacity = String(0.34 + level * 0.66);
    });
    visualFrame = requestAnimationFrame(draw);
  };
  draw();
}

function applyArtworkPrimaryColor(artwork) {
  if (!primaryColorFromArtwork || artwork === primaryArtwork) return;
  primaryArtwork = artwork;
  if (!artwork) return;
  getDominantColor(artwork).then((color) => {
    if (!color || artwork !== primaryArtwork) return;
    document.body.style.setProperty("--primary-color", color.hex);
    document.body.style.setProperty("--primary-color-rgb", `${color.red}, ${color.green}, ${color.blue}`);
  });
}

function getDominantColor(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(extractDominantColor(image));
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function extractDominantColor(image) {
  const canvas = document.createElement("canvas");
  const size = 48;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  let pixels;
  try {
    context.drawImage(image, 0, 0, size, size);
    pixels = context.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (alpha < 180) continue;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const lightness = (max + min) / 510;
    if (saturation < 0.18 || lightness < 0.16 || lightness > 0.88) continue;

    const key = `${Math.round(red / 24)},${Math.round(green / 24)},${Math.round(blue / 24)}`;
    const bucket = buckets.get(key) || { red: 0, green: 0, blue: 0, score: 0, count: 0 };
    const score = 1 + saturation * 2;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    bucket.score += score;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const best = Array.from(buckets.values()).sort((left, right) => right.score - left.score)[0];
  if (!best) return null;
  const color = brightenForVisibility(
    Math.round(best.red / best.count),
    Math.round(best.green / best.count),
    Math.round(best.blue / best.count)
  );
  const { red, green, blue } = color;
  return { red, green, blue, hex: rgbToHex(red, green, blue) };
}

function brightenForVisibility(red, green, blue) {
  let color = { red, green, blue };
  while (relativeLuminance(color.red, color.green, color.blue) < 0.42) {
    color = {
      red: mixChannel(color.red, 255, 0.22),
      green: mixChannel(color.green, 255, 0.22),
      blue: mixChannel(color.blue, 255, 0.22),
    };
  }
  return color;
}

function mixChannel(value, target, amount) {
  return Math.round(value + (target - value) * amount);
}

function relativeLuminance(red, green, blue) {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
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
    audio.play().then(startAdminVisualizer).catch(() => {
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
