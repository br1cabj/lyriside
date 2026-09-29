const status = document.querySelector("#status");
const video = document.querySelector("#video");
const results = document.querySelector("#results");
const empty = document.querySelector("#empty");
const tracks = document.querySelector("#tracks");
const nowPlaying = document.querySelector("#now-playing");
const editor = document.querySelector("#track-editor");
const DEFAULT_STATE = { settings: { minimal: false, theme: "violet" }, favorites: {}, corrections: {}, history: [] };
let appState = structuredClone(DEFAULT_STATE);
let videoData = null;
let lastPlayback = null;
let editingTrackId = null;

const setHidden = (element, hidden) => element.classList.toggle("hidden", hidden);
const escapeHtml = (value) => { const element = document.createElement("div"); element.textContent = value; return element.innerHTML; };
const confidenceLabel = (confidence) => ({ high: "Alta confianza · descripción del video", medium: "Confianza media · comentarios visibles", manual: "Añadida manualmente" })[confidence] || "Sin verificar";

function trackId(track) {
  if (track.id) return track.id;
  const name = track.title.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
  return `detected:${track.seconds ?? "none"}:${name}`;
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

function timestampToSeconds(timestamp) {
  if (!timestamp) return null;
  if (!/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(timestamp)) return null;
  return timestamp.split(":").reverse().reduce((total, part, index) => total + Number(part) * 60 ** index, 0);
}

async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return tab; }
async function sendToVideo(type, details = {}) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url?.includes("youtube.com/watch")) throw new Error("Abre un video de YouTube para usar la extensión.");
  return chrome.tabs.sendMessage(tab.id, { type, ...details });
}

function applyCorrections(rawData) {
  const correction = appState.corrections[rawData.videoId] || { removed: [], overrides: {}, additions: [] };
  const removed = new Set(correction.removed || []);
  const candidates = rawData.candidates.map((track) => ({ ...track, id: trackId(track) }))
    .filter((track) => !removed.has(track.id)).map((track) => ({ ...track, ...(correction.overrides?.[track.id] || {}) }));
  const additions = (correction.additions || []).filter((track) => !removed.has(track.id));
  return { ...rawData, candidates: [...candidates, ...additions].sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity)) };
}
async function saveState() { await chrome.storage.local.set(appState); }
function setTheme(theme) { appState.settings.theme = theme; document.body.dataset.theme = theme; document.querySelector("#theme").value = theme; }
function setMinimalMode(minimal) {
  appState.settings.minimal = minimal; document.body.classList.toggle("minimal", minimal);
  const toggle = document.querySelector("#view-mode"); toggle.textContent = minimal ? "Vista completa" : "Vista compacta"; toggle.setAttribute("aria-pressed", String(minimal));
}

function currentTrackAt(currentTime) {
  if (!videoData) return null;
  const timedTracks = videoData.candidates.filter((track) => Number.isFinite(track.seconds)).sort((a, b) => a.seconds - b.seconds);
  const activeIndex = timedTracks.findLastIndex((track) => track.seconds <= currentTime);
  return activeIndex === -1 ? null : { current: timedTracks[activeIndex], next: timedTracks[activeIndex + 1] || null };
}

function renderPlayback(playback) {
  lastPlayback = playback;
  const match = playback && currentTrackAt(playback.currentTime);
  setHidden(nowPlaying, !match);
  document.querySelectorAll(".track").forEach((track) => {
    const active = Boolean(match && track.dataset.id === match.current.id);
    const finished = Boolean(match && Number(track.dataset.seconds) < match.current.seconds);
    track.classList.toggle("current-track", active); track.classList.toggle("finished-track", finished); track.toggleAttribute("aria-current", active);
  });
  if (!match) return;
  document.querySelector("#now-title").textContent = match.current.title;
  document.querySelector("#play-state").textContent = playback.paused ? "Pausado" : "En vivo";
  document.querySelector("#now-details").textContent = `${formatTime(playback.currentTime)} · comienza en ${match.current.timestamp}`;
  document.querySelector("#next-track").textContent = match.next ? `Siguiente: ${match.next.timestamp} · ${match.next.title}` : "Última canción detectada del setlist.";
  const progress = playback.duration ? Math.min(100, (playback.currentTime / playback.duration) * 100) : 0;
  document.querySelector("#progress-fill").style.width = `${progress}%`;
  document.querySelector(".progress-track").setAttribute("aria-valuenow", String(Math.round(progress)));
}

function renderTrack(track) {
  const timestamp = track.timestamp || "—";
  const canSeek = Number.isFinite(track.seconds);
  return `<article class="track" data-id="${escapeHtml(track.id)}" data-seconds="${track.seconds ?? ""}">
    <span class="track-state" aria-hidden="true">○</span>
    <button class="jump-button" data-id="${escapeHtml(track.id)}" type="button" ${canSeek ? "" : "disabled"} title="${canSeek ? "Ir a este momento del video" : "Esta canción no tiene timestamp"}"><span class="timestamp">${escapeHtml(timestamp)}</span><span class="track-title">${escapeHtml(track.title)}</span></button>
    <span class="source" title="${escapeHtml(confidenceLabel(track.confidence))}">${escapeHtml(confidenceLabel(track.confidence))}</span>
    <div class="track-actions"><button class="text-button lyrics-track" data-id="${escapeHtml(track.id)}" type="button">Ver letra</button><button class="text-button edit-track" data-id="${escapeHtml(track.id)}" type="button">Editar</button><button class="text-button delete-track" data-id="${escapeHtml(track.id)}" type="button">Quitar</button></div>
  </article>`;
}
function renderTrackList() {
  if (!videoData) return;
  const query = document.querySelector("#track-search").value.trim().toLocaleLowerCase();
  const visibleTracks = videoData.candidates.filter((track) => track.title.toLocaleLowerCase().includes(query));
  tracks.innerHTML = visibleTracks.length ? visibleTracks.map(renderTrack).join("") : `<p class="muted no-results">No hay canciones que coincidan.</p>`;
  renderPlayback(lastPlayback);
}
function renderHistory() {
  const history = appState.history.slice(0, 6);
  document.querySelector("#history-list").innerHTML = history.length ? history.map((item) => `<a class="history-item" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><span>${appState.favorites[item.videoId] ? "★" : "☆"}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.channel || "YouTube")}</small></span></a>`).join("") : `<p class="muted">Aún no hay conciertos en tu historial.</p>`;
}
function render(data) {
  videoData = data; setHidden(video, false);
  document.querySelector("#video-title").textContent = data.title || "Video sin título";
  document.querySelector("#channel").textContent = data.channel || "YouTube";
  document.querySelector("#confidence").textContent = confidenceLabel(data.setlistConfidence);
  document.querySelector("#evidence").textContent = `Descripción: ${data.descriptionFound ? "sí" : "no"} · Comentarios visibles: ${data.visibleCommentCount}`;
  const favorite = Boolean(appState.favorites[data.videoId]); const favoriteButton = document.querySelector("#favorite");
  favoriteButton.textContent = favorite ? "★" : "☆"; favoriteButton.setAttribute("aria-pressed", String(favorite)); favoriteButton.title = favorite ? "Quitar de favoritos" : "Guardar en favoritos";
  const found = data.candidates.length > 0; setHidden(results, !found); setHidden(empty, found);
  document.querySelector("#count").textContent = `${data.candidates.length} canciones`; renderTrackList();
  status.textContent = found ? "Setlist listo. Pulsa una canción para saltar a ese momento." : "Análisis terminado.";
}

async function rememberVideo(data) {
  const item = { videoId: data.videoId, url: data.url, title: data.title, channel: data.channel, updatedAt: Date.now() };
  appState.history = [item, ...appState.history.filter((entry) => entry.videoId !== item.videoId)].slice(0, 20);
  await saveState(); renderHistory();
}
async function refreshPlayback() {
  if (!videoData?.candidates.some((track) => Number.isFinite(track.seconds))) return;
  try { renderPlayback(await sendToVideo("GET_PLAYBACK_STATE")); } catch { /* Navigation is transient. */ }
}
async function refresh() {
  status.textContent = "Analizando título, descripción y comentarios visibles…";
  setHidden(video, true); setHidden(results, true); setHidden(empty, true); setHidden(nowPlaying, true);
  try { const rawData = await sendToVideo("GET_VIDEO_METADATA"); render(applyCorrections(rawData)); await rememberVideo(videoData); refreshPlayback(); }
  catch (error) { status.textContent = error.message || "No se pudo analizar esta pestaña."; }
}

function openEditor(track = null) {
  editingTrackId = track?.id || null; document.querySelector("#editor-title").textContent = track ? "EDITAR CANCIÓN" : "AÑADIR CANCIÓN";
  document.querySelector("#track-timestamp").value = track?.timestamp || ""; document.querySelector("#track-title-input").value = track?.title || "";
  setHidden(editor, false); document.querySelector("#track-title-input").focus();
}
function closeEditor() { editingTrackId = null; setHidden(editor, true); }
async function persistTrack(track, originalId = null) {
  const correction = appState.corrections[videoData.videoId] ||= { removed: [], overrides: {}, additions: [] };
  if (originalId?.startsWith("manual:")) correction.additions = correction.additions.map((item) => item.id === originalId ? track : item);
  else if (originalId) correction.overrides[originalId] = track;
  else correction.additions.push(track);
  await saveState();
}
async function deleteTrack(id) {
  const correction = appState.corrections[videoData.videoId] ||= { removed: [], overrides: {}, additions: [] };
  correction.removed = [...new Set([...correction.removed, id])]; correction.additions = correction.additions.filter((track) => track.id !== id);
  await saveState(); videoData.candidates = videoData.candidates.filter((track) => track.id !== id);
  document.querySelector("#count").textContent = `${videoData.candidates.length} canciones`; renderTrackList();
}

document.querySelector("#refresh").addEventListener("click", refresh);
document.querySelector("#track-search").addEventListener("input", renderTrackList);
document.querySelector("#add-track").addEventListener("click", () => openEditor());
document.querySelector("#empty-add-track").addEventListener("click", () => openEditor());
document.querySelector("#cancel-edit").addEventListener("click", closeEditor);
document.querySelector("#theme").addEventListener("change", async (event) => { setTheme(event.target.value); await saveState(); });
document.querySelector("#view-mode").addEventListener("click", async () => { setMinimalMode(!appState.settings.minimal); await saveState(); });
document.querySelector("#favorite").addEventListener("click", async () => {
  if (!videoData) return;
  if (appState.favorites[videoData.videoId]) delete appState.favorites[videoData.videoId]; else appState.favorites[videoData.videoId] = true;
  await saveState(); render(videoData); renderHistory();
});
document.querySelector("#track-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const title = document.querySelector("#track-title-input").value.trim(); const timestamp = document.querySelector("#track-timestamp").value.trim(); const seconds = timestampToSeconds(timestamp);
  if (timestamp && seconds === null) return;
  const original = videoData.candidates.find((track) => track.id === editingTrackId);
  const track = { ...(original || {}), id: editingTrackId || `manual:${crypto.randomUUID()}`, title, timestamp: timestamp || null, seconds, source: "Manual", confidence: "manual" };
  await persistTrack(track, editingTrackId);
  videoData.candidates = original ? videoData.candidates.map((item) => item.id === editingTrackId ? track : item) : [...videoData.candidates, track].sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity));
  document.querySelector("#count").textContent = `${videoData.candidates.length} canciones`; closeEditor(); renderTrackList();
});
tracks.addEventListener("click", async (event) => {
  const button = event.target.closest("button"); if (!button || !videoData) return;
  const track = videoData.candidates.find((item) => item.id === button.dataset.id);
  if (button.classList.contains("jump-button") && track) { await sendToVideo("SEEK_TO", { seconds: track.seconds }); refreshPlayback(); }
  if (button.classList.contains("lyrics-track") && track) chrome.runtime.sendMessage({ type: "OPEN_LYRICS_SEARCH", artist: videoData.channel, track: track.title });
  if (button.classList.contains("edit-track") && track) openEditor(track);
  if (button.classList.contains("delete-track") && track) deleteTrack(track.id);
});
async function initialize() {
  appState = { ...DEFAULT_STATE, ...(await chrome.storage.local.get(DEFAULT_STATE)) }; appState.settings = { ...DEFAULT_STATE.settings, ...appState.settings };
  setTheme(appState.settings.theme); setMinimalMode(appState.settings.minimal); renderHistory(); setInterval(refreshPlayback, 1000); refresh();
}
initialize();
