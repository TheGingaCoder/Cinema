const app = document.querySelector("#app");

const projectorCode = "482913";

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
    </section>
  `;
}

function renderProjector() {
  return `
    <section class="projector-view">
      <div class="projector-stage">
        <video class="projector-media" playsinline preload="metadata" aria-label="Projector output"></video>
      </div>
      <div class="standby ambient-panel">
        <div>
          <p class="kicker">Projector</p>
          <div class="pairing-code">${projectorCode}</div>
          <p class="microcopy">Awaiting controller</p>
        </div>
      </div>
    </section>
  `;
}

function renderController() {
  return `
    <section class="view controller-view">
      <section class="projector-monitor">
        <div class="monitor-header">
          <div>
            <p class="kicker">Projector View</p>
            <h2>Live Output</h2>
          </div>
          <span class="status-pill">Standby</span>
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
          <input class="text-field" id="session-code" value="${projectorCode}" inputmode="numeric" />
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
            <button class="button button-primary" type="button">Play</button>
            <button class="button" type="button">Pause</button>
            <button class="button" type="button">Mute</button>
            <button class="button" type="button">Blackout</button>
          </div>
        </div>

        <div class="control-card status-card">
          <h2>Status</h2>
          <div class="status-grid">
            <div class="status-item">
              <span>Signal</span>
              <strong>Standby</strong>
            </div>
            <div class="status-item">
              <span>State</span>
              <strong>Idle</strong>
            </div>
            <div class="status-item">
              <span>Output</span>
              <strong>Black</strong>
            </div>
          </div>
        </div>
      </section>
    </section>
  `;
}

window.addEventListener("hashchange", render);
render();
