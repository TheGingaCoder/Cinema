import { firebaseConfig } from "./firebase-config.js";

const app = document.querySelector("#app");

const VERSION = "v0.4.0";
const SESSIONS_KEY = "cinema-link:sessions";
const PROJECTOR_SESSION_KEY = "cinema-link:projector-code";
const CONTROLLER_SESSION_KEY = "cinema-link:controller-code";
const REMOTE_POLL_INTERVAL = 1000;
const pairingChannel = "BroadcastChannel" in window ? new BroadcastChannel("cinema-link") : null;
let controllerNotice = "";
let controllerDraftCode = "";
let controllerMediaDraft = "";
let sessionsCache = {};
let firebaseReady = false;
let firebaseDatabaseUrl = "";
let remotePollTimer = null;

const routes = {
  "/": renderHome,
  "/projector": renderProjector,
  "/controller": renderController,
};

function navigate(path) {
  location.hash = path;
  render();
}

function render() {
  const path = location.hash.replace("#", "") || "/";
  const route = routes[path] || renderHome;
  app.innerHTML = route();
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const href = link.getAttribute("href");
      navigate(href.startsWith("#") ? href.slice(1) : href);
    });
  });

  document.querySelector("[data-action='join-session']")?.addEventListener("click", joinSessionFromInput);
  document.querySelector("[data-action='load-media']")?.addEventListener("click", loadMediaFromInput);
  document.querySelector("[data-action='clear-media']")?.addEventListener("click", clearSessionMedia);
  document.querySelector("#session-code")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      joinSessionFromInput();
    }
  });
  document.querySelector("#media-url")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loadMediaFromInput();
    }
  });
}

async function initRealtime() {
  firebaseDatabaseUrl = firebaseConfig?.databaseURL?.replace(/\/$/, "") || "";

  if (!firebaseDatabaseUrl) {
    sessionsCache = getLocalSessions();
    return;
  }

  firebaseReady = true;
  await syncRemoteSessions();
  remotePollTimer = window.setInterval(() => {
    syncRemoteSessions().catch((error) => {
      console.warn("Remote session sync failed.", error);
    });
  }, REMOTE_POLL_INTERVAL);
}

function getLocalSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || {};
  } catch {
    return {};
  }
}

function getSessions() {
  return firebaseReady ? sessionsCache : getLocalSessions();
}

function saveLocalSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  pairingChannel?.postMessage({ type: "sessions-updated" });
}

function generatePairingCode() {
  const sessions = getSessions();
  let code = "";

  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (sessions[code]);

  return code;
}

async function readRemoteSession(code) {
  if (!firebaseReady || !firebaseDatabaseUrl) {
    return getSessions()[code] || null;
  }

  const response = await fetch(`${firebaseDatabaseUrl}/sessions/${code}.json`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Unable to read session ${code}`);
  }

  return response.json();
}

async function syncRemoteSessions() {
  if (!firebaseReady || !firebaseDatabaseUrl) {
    return;
  }

  const response = await fetch(`${firebaseDatabaseUrl}/sessions.json`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to sync remote sessions");
  }

  sessionsCache = (await response.json()) || {};
  refreshPairedViews();
}

function saveRemoteSession(code, session) {
  fetch(`${firebaseDatabaseUrl}/sessions/${code}.json`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(session),
  }).catch((error) => {
    console.warn("Remote session save failed.", error);
  });
}

function touchSession(code, patch) {
  const sessions = getSessions();
  const current = sessions[code] || {
    code,
    createdAt: Date.now(),
    controllerOnline: false,
    projectorOnline: false,
  };

  sessions[code] = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };

  sessionsCache = sessions;

  if (firebaseReady && firebaseDatabaseUrl) {
    saveRemoteSession(code, sessions[code]);
  } else {
    saveLocalSessions(sessions);
  }

  return sessions[code];
}

function ensureProjectorSession() {
  const storedCode = sessionStorage.getItem(PROJECTOR_SESSION_KEY);
  const code = storedCode || generatePairingCode();
  sessionStorage.setItem(PROJECTOR_SESSION_KEY, code);
  return touchSession(code, { projectorOnline: true });
}

function getControllerSession() {
  const code = sessionStorage.getItem(CONTROLLER_SESSION_KEY);
  return code ? getSessions()[code] : null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getYouTubeId(value) {
  try {
    const normalizedValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(normalizedValue);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (host.endsWith("youtube.com")) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function createMediaFromUrl(value) {
  const sourceUrl = value.trim();
  const youtubeId = getYouTubeId(sourceUrl);

  if (!youtubeId) {
    return null;
  }

  return {
    type: "youtube",
    sourceUrl,
    youtubeId,
    loadedAt: Date.now(),
  };
}

function getYouTubeEmbedUrl(youtubeId, { muted = false } = {}) {
  const params = new URLSearchParams({
    autoplay: "1",
    controls: "0",
    disablekb: "1",
    modestbranding: "1",
    playsinline: "1",
    rel: "0",
  });

  if (muted) {
    params.set("mute", "1");
  }

  return `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?${params.toString()}`;
}

function renderMediaSurface(media, label = "Blackout active", options = {}) {
  if (media?.type === "youtube" && media.youtubeId) {
    return `
      <iframe
        class="media-frame"
        src="${getYouTubeEmbedUrl(media.youtubeId, options)}"
        title="YouTube media output"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    `;
  }

  return `<span>${escapeHtml(label)}</span>`;
}

async function joinSessionFromInput() {
  const input = document.querySelector("#session-code");
  const code = input?.value.replace(/\D/g, "").slice(0, 6);
  const session = code ? await readRemoteSession(code) : null;

  if (!input) {
    return;
  }

  input.value = code;
  controllerDraftCode = code;

  if (!session) {
    input.setAttribute("aria-invalid", "true");
    controllerNotice = "No active projector found for that code.";
    render();
    return;
  }

  input.removeAttribute("aria-invalid");
  controllerNotice = "Controller paired.";
  controllerDraftCode = code;
  sessionStorage.setItem(CONTROLLER_SESSION_KEY, code);
  touchSession(code, { controllerOnline: true });
  render();
}

function loadMediaFromInput() {
  const input = document.querySelector("#media-url");
  const code = sessionStorage.getItem(CONTROLLER_SESSION_KEY);
  const session = getControllerSession();
  const rawUrl = input?.value || "";
  const media = createMediaFromUrl(rawUrl);
  controllerMediaDraft = rawUrl;

  if (!code || !session?.projectorOnline) {
    controllerNotice = "Pair with a projector before loading media.";
    render();
    return;
  }

  if (!media) {
    controllerNotice = "Paste a valid YouTube URL.";
    render();
    return;
  }

  controllerMediaDraft = media.sourceUrl;
  controllerNotice = "YouTube media loaded.";
  touchSession(code, { media, controllerOnline: true });
  render();
}

function clearSessionMedia() {
  const code = sessionStorage.getItem(CONTROLLER_SESSION_KEY);

  if (!code) {
    controllerNotice = "Pair with a projector before clearing media.";
    render();
    return;
  }

  controllerMediaDraft = "";
  controllerNotice = "Projector returned to black.";
  touchSession(code, { media: null, controllerOnline: true });
  render();
}

function refreshPairedViews() {
  const path = location.hash.replace("#", "") || "/";

  if (path === "/projector" || path === "/controller") {
    render();
  }
}

function markCurrentRoleOffline() {
  const path = location.hash.replace("#", "") || "/";

  if (path === "/projector") {
    const code = sessionStorage.getItem(PROJECTOR_SESSION_KEY);
    if (code) {
      touchSession(code, { projectorOnline: false });
    }
  }

  if (path === "/controller") {
    const code = sessionStorage.getItem(CONTROLLER_SESSION_KEY);
    if (code) {
      touchSession(code, { controllerOnline: false });
    }
  }
}

function renderHome() {
  return `
    <section class="view center-view">
      <div class="ambient-panel">
        <p class="kicker">Cinema Link</p>
        <h1>Quiet control. Pure screen.</h1>
        <p class="lede">A paired projector and controller surface for private screenings, installations, and polished media playback.</p>
        <div class="role-grid">
          <a class="role-card" href="#/projector" data-route>
            <span>Display</span>
            <strong>Projector</strong>
          </a>
          <a class="role-card" href="#/controller" data-route>
            <span>Operator</span>
            <strong>Controller</strong>
          </a>
        </div>
      </div>
      <div class="version-tag">${VERSION}</div>
    </section>
  `;
}

function renderProjector() {
  const session = ensureProjectorSession();
  const pairingState = session.controllerOnline ? "Controller connected" : "Awaiting controller";
  const pairedClass = session.controllerOnline ? "projector-paired" : "";
  const projectorOutput = renderMediaSurface(session.media, "Blackout active");

  return `
    <section class="projector-view ${pairedClass}">
      <div class="projector-stage">
        ${projectorOutput}
      </div>
      <div class="standby ambient-panel">
        <div>
          <p class="kicker">Projector</p>
          <div class="pairing-code">${session.code}</div>
          <p class="microcopy">${pairingState}</p>
        </div>
      </div>
    </section>
  `;
}

function renderController() {
  const savedCode = controllerDraftCode || sessionStorage.getItem(CONTROLLER_SESSION_KEY) || "";
  const session = getControllerSession();
  const hasProjector = Boolean(session?.projectorOnline);
  const signal = hasProjector ? "Connected" : savedCode ? "No projector" : "Standby";
  const state = session?.controllerOnline ? "Paired" : "Idle";
  const output = session?.media?.type === "youtube" ? "YouTube" : hasProjector ? "Ready" : "Black";
  const sessionNote = controllerNotice || (hasProjector ? "Projector link is active." : "Enter the code shown on the projector.");
  const invalidState = controllerNotice.startsWith("No active") ? 'aria-invalid="true"' : "";
  const mediaValue = controllerMediaDraft || session?.media?.sourceUrl || "";
  const previewLabel = hasProjector ? "Blackout active" : "No media loaded";
  const previewOutput = renderMediaSurface(session?.media, previewLabel, { muted: true });

  return `
    <section class="view controller-view">
      <section class="projector-monitor">
        <div class="monitor-header">
          <div>
            <p class="kicker">Projector View</p>
            <h2>Live Output</h2>
          </div>
          <span class="status-pill">${signal}</span>
        </div>
        <div class="media-preview">
          ${previewOutput}
        </div>
      </section>

      <section class="controller-grid">
        <div class="control-card">
          <p class="kicker">Controller</p>
          <h2>Session</h2>
          <label class="field-label" for="session-code">Pairing Code</label>
          <input class="text-field" id="session-code" value="${savedCode}" inputmode="numeric" maxlength="6" placeholder="000000" ${invalidState} />
          <p class="session-note">${sessionNote}</p>
          <div class="button-row media-actions">
            <button class="button button-primary" type="button" data-action="join-session">Connect</button>
          </div>
        </div>

        <div class="control-card">
          <h2>Media</h2>
          <label class="field-label" for="media-url">Source URL</label>
          <input class="text-field" id="media-url" value="${escapeHtml(mediaValue)}" placeholder="https://youtube.com/watch?v=..." />
          <div class="button-row media-actions">
            <button class="button button-primary" type="button" data-action="load-media">Load</button>
            <button class="button" type="button" data-action="clear-media">Clear</button>
          </div>
        </div>

        <div class="control-card transport-card">
          <h2>Transport</h2>
          <input class="timeline" type="range" min="0" max="100" value="0" aria-label="Timeline" />
          <div class="transport-row">
            <button class="button icon-button button-primary" type="button" aria-label="Play">
              <i class="fa-solid fa-play" aria-hidden="true"></i>
            </button>
            <button class="button icon-button" type="button" aria-label="Pause">
              <i class="fa-solid fa-pause" aria-hidden="true"></i>
            </button>
            <button class="button icon-button" type="button" aria-label="Mute">
              <i class="fa-solid fa-volume-xmark" aria-hidden="true"></i>
            </button>
            <button class="button icon-button" type="button" aria-label="Blackout">
              <i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div class="control-card status-card">
          <h2>Status</h2>
          <div class="status-grid">
            <div class="status-item">
              <span>Signal</span>
              <strong>${signal}</strong>
            </div>
            <div class="status-item">
              <span>State</span>
              <strong>${state}</strong>
            </div>
            <div class="status-item">
              <span>Output</span>
              <strong>${output}</strong>
            </div>
          </div>
        </div>
      </section>
    </section>
  `;
}

window.addEventListener("hashchange", render);
window.addEventListener("storage", (event) => {
  if (event.key === SESSIONS_KEY) {
    sessionsCache = getLocalSessions();
    refreshPairedViews();
  }
});
pairingChannel?.addEventListener("message", refreshPairedViews);
window.addEventListener("beforeunload", markCurrentRoleOffline);
initRealtime()
  .catch((error) => {
    console.warn("Realtime setup failed. Falling back to local pairing.", error);
    firebaseReady = false;
    firebaseDatabaseUrl = "";
    if (remotePollTimer) {
      window.clearInterval(remotePollTimer);
      remotePollTimer = null;
    }
    sessionsCache = getLocalSessions();
  })
  .finally(render);
