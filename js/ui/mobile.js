import { extractColors } from "../analysis/color.js";
import {
  detectObjects,
  formatObjectScore,
  groupObjectsByLabel,
  renderBoundingBoxes,
  clearBoundingBoxes,
} from "../analysis/objects.js";
import { generateCaption } from "../analysis/caption.js";
import { analyzeComposition } from "../analysis/composition.js";
import { analysisSettings, getSettings } from "./sidebar.js";
import { getAnalysisResult, storeAnalysisResult } from "../utils/export.js";

const MOBILE_RESULT_KEYS = ["colors", "objects", "composition", "caption"];
const MOBILE_SETTINGS_TOGGLE_MAP = {
  "mobile-toggle-objects": { setting: "objects", desktopToggleId: "toggle-objects" },
  "mobile-toggle-color": { setting: "color", desktopToggleId: "toggle-color" },
  "mobile-toggle-caption": { setting: "caption", desktopToggleId: "toggle-caption" },
  "mobile-toggle-composition": {
    setting: "composition",
    desktopToggleId: "toggle-composition",
  },
  "mobile-toggle-emotion": { setting: "emotion", desktopToggleId: "toggle-emotion" },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTemperatureLabel(colors) {
  if (!colors?.length) {
    return "Balanced";
  }

  const weighted = colors.reduce(
    (sum, color) => {
      const { r, b } = color.rgb;
      return sum + (r - b) * (color.percentage / 100);
    },
    0,
  );

  if (weighted > 16) {
    return "Warm";
  }

  if (weighted < -16) {
    return "Cool";
  }

  return "Balanced";
}

function getMoodLabel(colors) {
  if (!colors?.length) {
    return "Neutral";
  }

  const avgSaturation = colors.reduce((sum, color) => {
    const { r, g, b } = color.rgb;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    return sum + (delta / 255) * 100 * (color.percentage / 100);
  }, 0);

  if (avgSaturation > 55) {
    return "Vivid";
  }

  if (avgSaturation < 25) {
    return "Calm";
  }

  return "Natural";
}

function buildMobileResultsShell() {
  return `
    <section class="mobile-results-card" id="mobile-results-card">
      <div class="mobile-results-section" data-section="colors">
        <h3 class="mobile-results-section__title">Colors</h3>
        <div class="mobile-results-section__content">
          <p class="mobile-placeholder">Analysing colors…</p>
        </div>
      </div>
      <div class="mobile-results-section" data-section="objects">
        <h3 class="mobile-results-section__title">Objects</h3>
        <div class="mobile-results-section__content">
          <p class="mobile-placeholder">Detecting objects…</p>
        </div>
      </div>
      <div class="mobile-results-section" data-section="composition">
        <h3 class="mobile-results-section__title">Composition</h3>
        <div class="mobile-results-section__content">
          <p class="mobile-placeholder">Analyzing composition…</p>
        </div>
      </div>
      <div class="mobile-results-section" data-section="caption">
        <h3 class="mobile-results-section__title">Caption</h3>
        <div class="mobile-results-section__content">
          <p class="mobile-placeholder">Generating caption…</p>
        </div>
      </div>
    </section>
  `;
}

function renderColorsSection(colors) {
  if (!colors?.length) {
    return `<p class="mobile-placeholder">No colors detected.</p>`;
  }

  const topColors = colors.slice(0, 4);
  const swatches = topColors
    .map(
      (color) => `
      <div class="mobile-color-item">
        <span class="mobile-color-item__swatch" style="background-color: ${color.hex}"></span>
        <span class="mobile-color-item__name">${escapeHtml(color.name)}</span>
        <span class="mobile-color-item__percentage">${color.percentage}%</span>
      </div>
    `,
    )
    .join("");

  return `
    <div class="mobile-color-row">${swatches}</div>
    <p class="mobile-color-summary">${getTemperatureLabel(colors)} · ${getMoodLabel(colors)}</p>
  `;
}

function renderObjectsSection(objects) {
  if (!objects?.length) {
    return `<p class="mobile-placeholder">No objects detected.</p>`;
  }

  const grouped = groupObjectsByLabel(objects);
  const badges = grouped
    .map((group) => {
      const toneClass = getMobileObjectToneClass(group.avgScore);
      const label = escapeHtml(group.label);
      const badgeText = `${label} (${group.count}) avg: ${formatObjectScore(group.avgScore)}`;

      if (group.count === 1) {
        return `
          <span class="mobile-object-badge ${toneClass}">
            ${badgeText}
          </span>
        `;
      }

      const detections = group.detections
        .map((detection, index) => {
          const detectionToneClass = getMobileObjectToneClass(detection.score);
          return `
            <li class="mobile-object-detection ${detectionToneClass}">
              <span>${label} ${index + 1} &mdash; ${formatObjectScore(detection.score)}</span>
            </li>
          `;
        })
        .join("");

      return `
        <details class="mobile-object-details">
          <summary class="mobile-object-badge ${toneClass}">
            <span>${badgeText}</span>
            <span class="mobile-object-chevron" aria-hidden="true">›</span>
          </summary>
          <ul class="mobile-object-detections">${detections}</ul>
        </details>
      `;
    })
    .join("");

  return `<div class="mobile-object-badges">${badges}</div>`;
}

function getMobileObjectToneClass(score) {
  if (score > 0.75) {
    return "mobile-object-badge--green";
  }

  if (score >= 0.5) {
    return "mobile-object-badge--amber";
  }

  return "mobile-object-badge--red";
}

function renderCompositionSection(composition) {
  if (!composition) {
    return `<p class="mobile-placeholder">Composition unavailable.</p>`;
  }

  const stats = [
    { label: "Orientation", value: composition.orientation },
    { label: "Aspect Ratio", value: composition.aspectRatio },
    { label: "Brightness", value: composition.brightnessScore },
    { label: "Contrast", value: composition.contrastScore },
    { label: "Lighting", value: composition.lightingType },
    { label: "Dominant Region", value: composition.dominantRegion },
  ];

  const cards = stats
    .map(
      (stat) => `
      <div class="mobile-composition-stat">
        <span class="mobile-composition-stat__label">${escapeHtml(stat.label)}</span>
        <span class="mobile-composition-stat__value">${escapeHtml(stat.value ?? "—")}</span>
      </div>
    `,
    )
    .join("");

  return `<div class="mobile-composition-grid">${cards}</div>`;
}

function renderCaptionSection(caption) {
  return `<blockquote class="mobile-caption">${escapeHtml(caption || "Caption unavailable")}</blockquote>`;
}

function updateSection(root, key, html) {
  const section = root.querySelector(
    `.mobile-results-section[data-section="${key}"] .mobile-results-section__content`,
  );

  if (section) {
    section.innerHTML = html;
  }
}

function buildHistoryCard(item, analysis) {
  const swatches = (analysis.colors ?? [])
    .slice(0, 3)
    .map(
      (color) =>
        `<span class="mobile-session-card__swatch" style="background-color: ${color.hex}"></span>`,
    )
    .join("");

  return `
    <button type="button" class="mobile-session-card" data-id="${item.id}">
      <img src="${item.src}" alt="${escapeHtml(item.name)}" class="mobile-session-card__thumb">
      <span class="mobile-session-card__caption">${escapeHtml(analysis.caption || "Caption unavailable")}</span>
      <span class="mobile-session-card__swatches">${swatches}</span>
    </button>
  `;
}

function updateMobileToggleVisual(toggleInput) {
  const label = toggleInput.closest(".toggle");
  if (label) {
    label.classList.toggle("toggle--active", toggleInput.checked);
  }
}

function syncDesktopToggle(toggleId, checked) {
  const desktopToggle = document.getElementById(toggleId);
  if (!desktopToggle) {
    return;
  }

  desktopToggle.checked = checked;
  const desktopLabel = desktopToggle.closest(".toggle");
  if (desktopLabel) {
    desktopLabel.classList.toggle("toggle--active", checked);
  }
}

export function initMobileView(options = {}) {
  const { onImageStored, initialSessionItems = [] } = options;
  const mainContent = document.getElementById("main-content");

  if (!mainContent) {
    return { destroy() {} };
  }

  const sessionItems = initialSessionItems
    .filter((item) => item?.id !== undefined && item?.src)
    .filter((item) => getAnalysisResult(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      src: item.src,
      file: item.file,
    }));
  let currentItem = null;

  const preservedNodes = Array.from(mainContent.children);
  for (const node of preservedNodes) {
    const wasHidden = node.classList.contains("hidden");
    node.classList.add("hidden");
    node.setAttribute("data-mobile-hidden", "true");
    node.setAttribute("data-mobile-was-hidden", String(wasHidden));
  }

  const mobileRoot = document.createElement("div");
  mobileRoot.className = "mobile-view";
  mobileRoot.innerHTML = `
    <section class="mobile-upload" id="mobile-upload-zone">
      <input type="file" id="mobile-camera-input" accept="image/*" capture="environment" hidden>
      <input type="file" id="mobile-file-input" accept="image/*" hidden>
      <button type="button" id="mobile-btn-camera" class="mobile-upload__button">📷 Take Photo</button>
      <button type="button" id="mobile-btn-upload" class="mobile-upload__button mobile-upload__button--secondary">🖼 Upload Image</button>
      <p class="mobile-upload__note">Models load once and cache in your browser — no data is sent to any server</p>
    </section>

    <section class="mobile-analysis hidden" id="mobile-analysis-view">
      <div class="mobile-analysis__image-wrap" id="mobile-analysis-image-wrap">
        <img class="mobile-analysis__image" id="mobile-analysis-image" alt="Selected image">
      </div>
      ${buildMobileResultsShell()}
      <button type="button" id="mobile-btn-reset" class="mobile-reset-btn">Analyse another image</button>
      <section class="mobile-session">
        <h3 class="mobile-session__title">This session</h3>
        <div class="mobile-session__list" id="mobile-session-list">
          <p class="mobile-session__empty">No previous analyses yet</p>
        </div>
      </section>
    </section>
  `;
  mainContent.appendChild(mobileRoot);

  const uploadZone = mobileRoot.querySelector("#mobile-upload-zone");
  const analysisView = mobileRoot.querySelector("#mobile-analysis-view");
  const imageWrap = mobileRoot.querySelector("#mobile-analysis-image-wrap");
  const analysisImage = mobileRoot.querySelector("#mobile-analysis-image");
  const cameraInput = mobileRoot.querySelector("#mobile-camera-input");
  const fileInput = mobileRoot.querySelector("#mobile-file-input");
  const sessionList = mobileRoot.querySelector("#mobile-session-list");
  const resetButton = mobileRoot.querySelector("#mobile-btn-reset");
  const settingsButton = document.getElementById("mobile-top-settings-btn");
  const settingsOverlay = document.getElementById("mobile-settings-overlay");
  const settingsSheet = document.getElementById("mobile-settings-sheet");
  const settingsDoneButton = document.getElementById("mobile-settings-done");

  function openSettingsSheet() {
    if (!settingsSheet || !settingsOverlay) {
      return;
    }

    for (const [toggleId, meta] of Object.entries(MOBILE_SETTINGS_TOGGLE_MAP)) {
      const mobileToggle = document.getElementById(toggleId);
      if (!mobileToggle) {
        continue;
      }

      mobileToggle.checked = Boolean(analysisSettings[meta.setting]);
      updateMobileToggleVisual(mobileToggle);
    }

    settingsSheet.classList.add("bottom-sheet--open");
    settingsOverlay.classList.add("mobile-settings-overlay--open");
  }

  function closeSettingsSheet() {
    if (!settingsSheet || !settingsOverlay) {
      return;
    }

    settingsSheet.classList.remove("bottom-sheet--open");
    settingsOverlay.classList.remove("mobile-settings-overlay--open");
  }

  function initMobileSettingsSheet() {
    for (const [toggleId, meta] of Object.entries(MOBILE_SETTINGS_TOGGLE_MAP)) {
      const mobileToggle = document.getElementById(toggleId);
      if (!mobileToggle) {
        continue;
      }

      mobileToggle.checked = Boolean(analysisSettings[meta.setting]);
      updateMobileToggleVisual(mobileToggle);
      syncDesktopToggle(meta.desktopToggleId, mobileToggle.checked);

      mobileToggle.onchange = () => {
        analysisSettings[meta.setting] = mobileToggle.checked;
        updateMobileToggleVisual(mobileToggle);
        syncDesktopToggle(meta.desktopToggleId, mobileToggle.checked);

        window.dispatchEvent(
          new CustomEvent("settings-changed", {
            detail: {
              analysisSettings: { ...analysisSettings },
              parameters: { ...getSettings().parameters },
              changed: {
                toggles: [meta.setting],
                parameters: [],
              },
            },
          }),
        );
      };
    }

    if (settingsButton) {
      settingsButton.onclick = openSettingsSheet;
    }
    if (settingsDoneButton) {
      settingsDoneButton.onclick = closeSettingsSheet;
    }
    if (settingsOverlay) {
      settingsOverlay.onclick = closeSettingsSheet;
    }
  }

  function clearMobileBoundingBoxes() {
    if (!imageWrap) {
      return;
    }

    clearBoundingBoxes(currentItem?.id);
    const layer = imageWrap.querySelector(".bounding-boxes");
    if (layer) {
      layer.remove();
    }
  }

  function drawMobileBoundingBoxes(itemId, objects) {
    if (!imageWrap || !analysisImage) {
      return;
    }

    clearMobileBoundingBoxes();
    if (!objects?.length) {
      return;
    }

    const draw = () => {
      renderBoundingBoxes(itemId, objects, true, imageWrap, analysisImage);
    };

    if (analysisImage.complete && analysisImage.naturalWidth > 0) {
      draw();
      return;
    }

    analysisImage.addEventListener("load", draw, { once: true });
  }

  function renderSessionHistory() {
    if (!sessionItems.length) {
      sessionList.innerHTML = `<p class="mobile-session__empty">No previous analyses yet</p>`;
      return;
    }

    const html = sessionItems
      .map((item) => buildHistoryCard(item, getAnalysisResult(item.id) ?? {}))
      .join("");
    sessionList.innerHTML = html;

    for (const card of sessionList.querySelectorAll(".mobile-session-card")) {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        const item = sessionItems.find((entry) => String(entry.id) === String(id));
        if (!item) {
          return;
        }

        const results = getAnalysisResult(item.id);
        if (!results) {
          return;
        }

        currentItem = item;
        analysisImage.src = item.src;
        updateSection(analysisView, "colors", renderColorsSection(results.colors ?? []));
        updateSection(
          analysisView,
          "objects",
          renderObjectsSection(results.objects ?? []),
        );
        updateSection(
          analysisView,
          "composition",
          renderCompositionSection(results.composition ?? null),
        );
        updateSection(
          analysisView,
          "caption",
          renderCaptionSection(results.caption),
        );
        drawMobileBoundingBoxes(item.id, results.objects ?? []);
        uploadZone.classList.add("hidden");
        analysisView.classList.remove("hidden");
      });
    }
  }

  function resetToUpload() {
    clearMobileBoundingBoxes();
    uploadZone.classList.remove("hidden");
    analysisView.classList.add("hidden");
    currentItem = null;
  }

  async function analyzeMobileImage(item) {
    const { parameters } = getSettings();
    const imageSrc = item.src;
    const result = {
      caption: null,
      colors: null,
      objects: null,
      composition: null,
      analyzedAt: new Date().toISOString(),
    };

    analysisImage.src = imageSrc;
    clearMobileBoundingBoxes();
    updateSection(analysisView, "colors", `<p class="mobile-placeholder">Analysing colors…</p>`);
    updateSection(analysisView, "objects", `<p class="mobile-placeholder">Detecting objects…</p>`);
    updateSection(analysisView, "composition", `<p class="mobile-placeholder">Analyzing composition…</p>`);
    updateSection(analysisView, "caption", `<p class="mobile-placeholder">Generating caption…</p>`);

    uploadZone.classList.add("hidden");
    analysisView.classList.remove("hidden");

    try {
      result.colors = await extractColors(imageSrc, parameters.colorsToExtract);
      updateSection(analysisView, "colors", renderColorsSection(result.colors));
    } catch {
      updateSection(analysisView, "colors", `<p class="mobile-placeholder">Color analysis failed.</p>`);
    }

    try {
      result.objects = await detectObjects(imageSrc, {
        threshold: parameters.confidence,
        maxObjects: parameters.maxObjects,
      });
      updateSection(analysisView, "objects", renderObjectsSection(result.objects));
      drawMobileBoundingBoxes(item.id, result.objects);
    } catch {
      updateSection(
        analysisView,
        "objects",
        `<p class="mobile-placeholder">Object detection failed.</p>`,
      );
      clearMobileBoundingBoxes();
    }

    try {
      result.composition = await analyzeComposition(imageSrc);
      updateSection(
        analysisView,
        "composition",
        renderCompositionSection(result.composition),
      );
    } catch {
      updateSection(
        analysisView,
        "composition",
        `<p class="mobile-placeholder">Composition analysis failed.</p>`,
      );
    }

    try {
      result.caption = await generateCaption(imageSrc);
      updateSection(analysisView, "caption", renderCaptionSection(result.caption));
    } catch {
      updateSection(
        analysisView,
        "caption",
        `<p class="mobile-placeholder">Caption unavailable.</p>`,
      );
    }

    storeAnalysisResult(item.id, result);

    if (!sessionItems.some((existing) => String(existing.id) === String(item.id))) {
      sessionItems.unshift(item);
    }

    renderSessionHistory();
  }

  function handleFiles(fileList) {
    const files = Array.from(fileList ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );

    if (!files.length) {
      return;
    }

    const file = files[0];
    const reader = new FileReader();
    const id = Date.now();

    reader.onload = async () => {
      const item = {
        id,
        name: file.name || `Mobile image ${id}`,
        src: reader.result,
        file,
      };

      if (typeof onImageStored === "function") {
        onImageStored(item);
      }

      currentItem = item;

      const existing = getAnalysisResult(item.id);
      if (
        existing &&
        MOBILE_RESULT_KEYS.every((key) => existing[key] !== null && existing[key] !== undefined)
      ) {
        analysisImage.src = item.src;
        updateSection(analysisView, "colors", renderColorsSection(existing.colors ?? []));
        updateSection(analysisView, "objects", renderObjectsSection(existing.objects ?? []));
        updateSection(
          analysisView,
          "composition",
          renderCompositionSection(existing.composition ?? null),
        );
        updateSection(analysisView, "caption", renderCaptionSection(existing.caption));
        drawMobileBoundingBoxes(item.id, existing.objects ?? []);
        uploadZone.classList.add("hidden");
        analysisView.classList.remove("hidden");
        if (!sessionItems.some((entry) => String(entry.id) === String(item.id))) {
          sessionItems.unshift(item);
          renderSessionHistory();
        }
        return;
      }

      await analyzeMobileImage(item);
    };

    reader.readAsDataURL(file);
  }

  mobileRoot.querySelector("#mobile-btn-camera").addEventListener("click", () => {
    cameraInput.click();
  });
  mobileRoot.querySelector("#mobile-btn-upload").addEventListener("click", () => {
    fileInput.click();
  });

  cameraInput.addEventListener("change", () => {
    handleFiles(cameraInput.files);
    cameraInput.value = "";
  });
  fileInput.addEventListener("change", () => {
    handleFiles(fileInput.files);
    fileInput.value = "";
  });

  resetButton.addEventListener("click", resetToUpload);
  renderSessionHistory();
  initMobileSettingsSheet();

  return {
    destroy() {
      mobileRoot.remove();
      closeSettingsSheet();
      for (const node of mainContent.querySelectorAll("[data-mobile-hidden=\"true\"]")) {
        if (node.getAttribute("data-mobile-was-hidden") !== "true") {
          node.classList.remove("hidden");
        }
        node.removeAttribute("data-mobile-hidden");
        node.removeAttribute("data-mobile-was-hidden");
      }
    },
  };
}
