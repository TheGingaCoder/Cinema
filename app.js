const app = document.querySelector("#app");

const VERSION = "v0.1.0";
const SESSIONS_KEY = "cinema-link:sessions";
const PROJECTOR_SESSION_KEY = "cinema-link:projector-code";
const CONTROLLER_SESSION_KEY = "cinema-link:controller-code";
const pairingChannel = "BroadcastChannel" in window ? new BroadcastChannel("cinema-link") : null;
let controllerNotice = "";
let controllerDraftCode = "";

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
  document.querySelector("#session-code")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      joinSessionFromInput();
    }
  });
}

function getSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSessions(sessions) {
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

  saveSessions(sessions);
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

function joinSessionFromInput() {
  const input = document.querySelector("#session-code");
  const code = input?.value.replace(/\D/g, "").slice(0, 6);
  const session = code ? getSessions()[code] : null;

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

  return `
    <section class="projector-view">
      <div class="projector-stage">
        <video class="projector-media" playsinline preload="metadata" aria-label="Projector output"></video>
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
  const output = hasProjector ? "Ready" : "Black";
  const sessionNote = controllerNotice || (hasProjector ? "Projector link is active." : "Enter the code shown on the projector.");
  const invalidState = controllerNotice.startsWith("No active") ? 'aria-invalid="true"' : "";

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
          <span>No media loaded</span>
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
          <input class="text-field" id="media-url" placeholder="https://..." />
          <div class="button-row media-actions">
            <button class="button button-primary" type="button">Load</button>
            <button class="button" type="button">Clear</button>
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
    refreshPairedViews();
  }
});
pairingChannel?.addEventListener("message", refreshPairedViews);
window.addEventListener("beforeunload", markCurrentRoleOffline);
render();
