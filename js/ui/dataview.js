import {
  convertBoxToPercentages,
  getLabelColor,
} from "../analysis/objects.js";

let containerElement = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDimensionSource() {
  return document.querySelector(".deep-analysis__image");
}

function syncCanvasAspectRatio(canvas) {
  const dimensionSource = getDimensionSource();

  if (
    canvas &&
    dimensionSource?.naturalWidth &&
    dimensionSource?.naturalHeight
  ) {
    canvas.style.aspectRatio = `${dimensionSource.naturalWidth} / ${dimensionSource.naturalHeight}`;
  }
}

function renderDataViewBoxes(canvas, objects) {
  const boxesLayer = canvas.querySelector(".data-view__boxes");
  if (!boxesLayer) {
    return;
  }

  boxesLayer.replaceChildren();

  const dimensionSource = getDimensionSource();
  if (!objects?.length || !dimensionSource) {
    return;
  }

  for (const object of objects) {
    const percentBox = convertBoxToPercentages(object.box, dimensionSource);
    if (!percentBox) {
      continue;
    }

    const color = getLabelColor(object.label);
    const boxEl = document.createElement("div");
    boxEl.className = "data-view__box";
    boxEl.style.left = `${percentBox.left}%`;
    boxEl.style.top = `${percentBox.top}%`;
    boxEl.style.width = `${percentBox.width}%`;
    boxEl.style.height = `${percentBox.height}%`;
    boxEl.style.borderColor = color;

    const labelEl = document.createElement("span");
    labelEl.className = "data-view__box-label";
    labelEl.textContent = `${object.label} ${object.score}`;

    boxEl.appendChild(labelEl);
    boxesLayer.appendChild(boxEl);
  }
}

function renderColorZone(canvas, colors) {
  const colorZone = canvas.querySelector(".data-view__color-zone");
  if (!colorZone) {
    return;
  }

  colorZone.replaceChildren();

  if (!colors?.length) {
    return;
  }

  for (const color of colors) {
    const band = document.createElement("div");
    band.className = "data-view__color-band";
    band.style.backgroundColor = color.hex;
    band.style.flexGrow = String(color.percentage);
    band.style.flexBasis = "0";

    const label = document.createElement("span");
    label.className = "data-view__color-band-label";
    label.textContent = color.hex;

    band.appendChild(label);
    colorZone.appendChild(band);
  }
}

function populateDataView(imageId, analysisResult = {}) {
  if (!containerElement) {
    return;
  }

  const root = containerElement.querySelector(".data-view");
  if (!root) {
    return;
  }

  const canvas = root.querySelector(".data-view__canvas");
  if (!canvas) {
    return;
  }

  syncCanvasAspectRatio(canvas);
  renderDataViewBoxes(canvas, analysisResult.objects ?? []);
  renderColorZone(canvas, analysisResult.colors ?? []);
}

export function initDataView(containerId, imageId, analysisResult) {
  containerElement = document.getElementById(containerId);

  if (!containerElement) {
    return;
  }

  containerElement.innerHTML = `
    <div class="data-view" data-image-id="${String(imageId)}">
      <div class="data-view__canvas-area">
        <div class="data-view__canvas" data-image-id="${String(imageId)}">
          <div class="data-view__boxes"></div>
          <div class="data-view__color-zone" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  `;

  populateDataView(imageId, analysisResult);
}

export function showDataView(imageId, analysisResult) {
  populateDataView(imageId, analysisResult);

  const imagePanel = document.querySelector(
    ".deep-analysis__panel--image-view",
  );
  const dataPanel = document.querySelector(".deep-analysis__panel--data-view");
  const overlayToggles = document.querySelector("#deep-analysis-overlay-toggles");

  if (imagePanel) {
    imagePanel.classList.add("hidden");
  }

  if (dataPanel) {
    dataPanel.classList.remove("hidden");
  }

  if (overlayToggles) {
    overlayToggles.classList.add("hidden");
  }
}

export function hideDataView() {
  const imagePanel = document.querySelector(
    ".deep-analysis__panel--image-view",
  );
  const dataPanel = document.querySelector(".deep-analysis__panel--data-view");
  const overlayToggles = document.querySelector("#deep-analysis-overlay-toggles");

  if (imagePanel) {
    imagePanel.classList.remove("hidden");
  }

  if (dataPanel) {
    dataPanel.classList.add("hidden");
  }

  if (overlayToggles) {
    overlayToggles.classList.remove("hidden");
  }
}
