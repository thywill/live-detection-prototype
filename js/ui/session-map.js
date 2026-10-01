// On-demand map of the walked GPS path from the in-memory detection log. Read-only.
import { getLiveDetectionLog } from "../live/detection-log.js";

const LEAFLET_CSS =
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const LEAFLET_JS =
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const SINGLE_POINT_ZOOM = 18;

let map = null;
let leafletLoader = null;
let openGeneration = 0;

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      reject(new Error("Leaflet CSS failed to load"));
    };
    document.head.appendChild(link);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Leaflet failed to load"));
    };
    document.head.appendChild(script);
  });
}

function loadLeaflet() {
  if (window.L?.map) {
    return Promise.resolve(window.L);
  }
  if (!leafletLoader) {
    leafletLoader = Promise.all([
      loadStylesheet(LEAFLET_CSS),
      loadScript(LEAFLET_JS),
    ])
      .then(() => window.L)
      .catch((error) => {
        leafletLoader = null;
        throw error;
      });
  }
  return leafletLoader;
}

function isValidCoordinate(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

function extractPath(rows) {
  const fixes = [];
  rows.forEach((row, index) => {
    if (row.lat == null || row.lon == null) {
      return;
    }
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!isValidCoordinate(lat, lon)) {
      return;
    }
    fixes.push({ lat, lon, timestamp: Number(row.timestamp), index });
  });

  fixes.sort(
    (a, b) =>
      (Number.isFinite(a.timestamp) ? a.timestamp : 0) -
        (Number.isFinite(b.timestamp) ? b.timestamp : 0) || a.index - b.index,
  );

  const path = [];
  for (const fix of fixes) {
    const last = path.at(-1);
    if (last && last[0] === fix.lat && last[1] === fix.lon) {
      continue;
    }
    path.push([fix.lat, fix.lon]);
  }
  return path;
}

function themeColor(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function destroyMap() {
  map?.remove();
  map = null;
}

function drawMap(L, container, path) {
  destroyMap();
  map = L.map(container, { zoomControl: true });
  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: TILE_ATTRIBUTION,
  }).addTo(map);

  const accent = themeColor("--color-accent", "#2563eb");
  const panel = themeColor("--color-bg-panel", "#ffffff");
  const start = path[0];
  const end = path.at(-1);

  if (path.length > 1) {
    const line = L.polyline(path, { color: accent, weight: 4, opacity: 0.9 })
      .addTo(map);
    map.fitBounds(line.getBounds(), { padding: [32, 32] });
  } else {
    map.setView(start, SINGLE_POINT_ZOOM);
  }

  L.circleMarker(start, {
    radius: 7,
    color: panel,
    weight: 2,
    fillColor: "#16a34a",
    fillOpacity: 1,
  })
    .bindTooltip("Start")
    .addTo(map);

  if (path.length > 1) {
    L.circleMarker(end, {
      radius: 7,
      color: panel,
      weight: 2,
      fillColor: "#dc2626",
      fillOpacity: 1,
    })
      .bindTooltip("End")
      .addTo(map);
  }
}

export function initSessionMap() {
  const button = document.getElementById("btn-map");
  const panel = document.getElementById("session-map");
  const closeButton = document.getElementById("btn-map-close");
  const empty = document.getElementById("map-empty");
  const errorNote = document.getElementById("map-error");
  const canvas = document.getElementById("map-canvas");
  const summaryButton = document.getElementById("btn-summary");

  if (!button || !panel || !closeButton || !empty || !errorNote || !canvas) {
    return;
  }

  function isOpen() {
    return button.getAttribute("aria-pressed") === "true";
  }

  function closeMap({ restoreFocus = true } = {}) {
    openGeneration += 1;
    destroyMap();
    panel.classList.add("hidden");
    button.setAttribute("aria-pressed", "false");
    if (restoreFocus) {
      button.focus();
    }
  }

  async function openMap() {
    const generation = ++openGeneration;
    if (summaryButton?.getAttribute("aria-pressed") === "true") {
      summaryButton.click();
    }

    const path = extractPath(getLiveDetectionLog().slice());
    button.setAttribute("aria-pressed", "true");
    panel.classList.remove("hidden");
    errorNote.classList.add("hidden");

    const hasPath = path.length > 0;
    empty.classList.toggle("hidden", hasPath);
    canvas.classList.toggle("hidden", !hasPath);
    if (!hasPath) {
      destroyMap();
      closeButton.focus();
      return;
    }

    try {
      const L = await loadLeaflet();
      if (generation !== openGeneration || !L) {
        return;
      }
      drawMap(L, canvas, path);
    } catch (error) {
      console.error("[MAP] map failed:", error);
      if (generation !== openGeneration) {
        return;
      }
      destroyMap();
      canvas.classList.add("hidden");
      errorNote.classList.remove("hidden");
    }
  }

  button.addEventListener("click", () => {
    if (isOpen()) {
      closeMap();
    } else {
      openMap();
    }
  });
  closeButton.addEventListener("click", () => closeMap());
  summaryButton?.addEventListener("click", () => {
    if (isOpen()) {
      closeMap({ restoreFocus: false });
    }
  });
}
