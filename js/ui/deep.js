import {
  detectObjects,
  renderBoundingBoxes,
  clearBoundingBoxes,
  groupObjectsByLabel,
  formatObjectScore,
} from "../analysis/objects.js";
import {
  extractColors,
  renderColorStrip,
  renderColorResults,
} from "../analysis/color.js";
import {
  generateCaption,
  updateGalleryCaption,
  renderCaptionResult,
} from "../analysis/caption.js";
import {
  analyzeComposition,
  renderCompositionResults,
} from "../analysis/composition.js";
import {
  detectEmotion,
  renderEmotionResults,
  shouldRunEmotion,
} from "../analysis/emotion.js";
import {
  analyzePhotoStyle,
  renderPhotoStyleResults,
} from "../analysis/photo-style.js";
import { getSettings } from "./sidebar.js";
import {
  exportSingleImageReport,
  getAnalysisResult,
  storeAnalysisResult,
} from "../utils/export.js";
import {
  applyOverlayClasses,
  wireOverlayToggleButtons,
} from "../utils/overlays.js";
import {
  initDataView,
  showDataView,
  hideDataView,
} from "./dataview.js";

const DEEP_DATA_VIEW_CONTAINER_ID = "deep-data-view-container";

let deepView = null;
let currentImage = null;
let currentObjectResults = [];
let currentColors = [];
let activeTab = "image";

const SECTION_LABELS = {
  objects: "Objects",
  color: "Color",
  caption: "Caption",
  composition: "Composition",
  emotion: "Emotion",
  photoStyle: "Photo Style",
};

const SECTION_LOADING_MESSAGES = {
  objects: "Running object detection…",
  color: "Analyzing colors…",
  caption: "Generating caption…",
  composition: "Analyzing composition…",
  emotion: "Detecting emotion…",
  photoStyle: "Analysing style…",
};

const MODEL_LABELS = {
  objectDetector: "object detection",
  captioner: "caption",
  emotionDetector: "emotion detection",
  sceneClassifier: "scene classification",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sectionLoadingHtml(message) {
  return `<div class="section-loading">
    <span class="section-loading__spinner" aria-hidden="true"></span>
    <span class="section-loading__text">${message}</span>
  </div>`;
}

function showStatusBar(message = "") {
  const statusBar = deepView?.querySelector("#deep-analysis-status-bar");
  if (!statusBar) {
    return;
  }

  statusBar.classList.remove("hidden");
  statusBar.textContent = message;
}

function setStatusMessage(message) {
  const statusBar = deepView?.querySelector("#deep-analysis-status-bar");
  if (statusBar) {
    statusBar.textContent = message;
    statusBar.classList.remove("hidden");
  }
}

function hideStatusBar() {
  const statusBar = deepView?.querySelector("#deep-analysis-status-bar");
  if (statusBar) {
    statusBar.classList.add("hidden");
    statusBar.textContent = "";
  }
}

function initializeSectionLoadingStates(analysisSettings, existing = {}) {
  const existingKeyMap = {
    objects: "objects",
    color: "colors",
    caption: "caption",
    composition: "composition",
    emotion: "emotion",
    photoStyle: "photoStyle",
  };

  for (const key of Object.keys(SECTION_LOADING_MESSAGES)) {
    const existingField = existingKeyMap[key];
    if (analysisSettings[key] && !existing[existingField]) {
      updateSection(key, sectionLoadingHtml(SECTION_LOADING_MESSAGES[key]));
    }
  }
}

function refreshDataViewIfActive(analysisResult) {
  if (activeTab === "data" && currentImage) {
    showDataView(currentImage.id, analysisResult);
  }
}

function applyDeepOverlayPreferences() {
  const imageWrap = deepView?.querySelector(".deep-analysis__image-wrap");
  applyOverlayClasses(imageWrap);
}

function renderDeepBoundingBoxes(imageId, objects) {
  const refImage = deepView?.querySelector(".deep-analysis__image");
  const imageWrap = deepView?.querySelector(".deep-analysis__image-wrap");
  renderBoundingBoxes(imageId, objects, true, imageWrap, refImage);
  applyDeepOverlayPreferences();
}

function formatObjectResults(results) {
  if (!results?.length) {
    return "<p class=\"deep-analysis__muted\">No objects detected.</p>";
  }

  const groupedObjects = groupObjectsByLabel(results);
  const items = groupedObjects
    .map((group) => {
      const toneClass = getObjectToneClass(group.avgScore);
      const label = escapeHtml(group.label);
      const badgeText = `${label} (${group.count}) avg: ${formatObjectScore(group.avgScore)}`;

      if (group.count === 1) {
        return `<li class="deep-analysis__object-item">
          <span class="deep-analysis__object-badge ${toneClass}">${badgeText}</span>
        </li>`;
      }

      const detections = group.detections
        .map((detection, index) => {
          const detectionToneClass = getObjectToneClass(detection.score);
          return `<li class="deep-analysis__object-detection ${detectionToneClass}">
            <span>${label} ${index + 1} &mdash; ${formatObjectScore(detection.score)}</span>
          </li>`;
        })
        .join("");

      return `<li class="deep-analysis__object-item">
          <details class="deep-analysis__object-details">
            <summary class="deep-analysis__object-badge ${toneClass}">
              <span>${badgeText}</span>
              <span class="deep-analysis__object-chevron" aria-hidden="true">›</span>
            </summary>
            <ul class="deep-analysis__object-detections">${detections}</ul>
          </details>
        </li>`;
    })
    .join("");

  return `<ul class="deep-analysis__object-list">${items}</ul>`;
}

function getObjectToneClass(score) {
  if (score > 0.75) {
    return "deep-analysis__object-badge--green";
  }

  if (score >= 0.5) {
    return "deep-analysis__object-badge--amber";
  }

  return "deep-analysis__object-badge--red";
}

function updateSection(sectionKey, html) {
  if (!deepView) {
    return;
  }

  const section = deepView.querySelector(
    `[data-section="${sectionKey}"] .deep-analysis__section-content`,
  );

  if (section) {
    section.innerHTML = html;
  }
}

function refreshResultsPanel(analysisSettings) {
  if (!deepView || !currentImage) {
    return;
  }

  const aside = deepView.querySelector(".deep-analysis__results");
  if (!aside) {
    return;
  }

  const existing = getAnalysisResult(currentImage.id) ?? {};
  aside.innerHTML = buildResultsSections(analysisSettings);

  if (analysisSettings.objects) {
    updateSection(
      "objects",
      existing.objects
        ? formatObjectResults(existing.objects)
        : sectionLoadingHtml(SECTION_LOADING_MESSAGES.objects),
    );
  }

  if (analysisSettings.color) {
    updateSection(
      "color",
      existing.colors
        ? renderColorResults(existing.colors)
        : sectionLoadingHtml(SECTION_LOADING_MESSAGES.color),
    );
  }

  if (analysisSettings.caption) {
    updateSection(
      "caption",
      existing.caption
        ? renderCaptionResult(existing.caption)
        : sectionLoadingHtml(SECTION_LOADING_MESSAGES.caption),
    );
  }

  if (analysisSettings.composition) {
    updateSection(
      "composition",
      existing.composition
        ? renderCompositionResults(existing.composition)
        : sectionLoadingHtml(SECTION_LOADING_MESSAGES.composition),
    );
  }

  if (analysisSettings.emotion) {
    updateSection(
      "emotion",
      existing.emotion
        ? renderEmotionResults(existing.emotion)
        : sectionLoadingHtml(SECTION_LOADING_MESSAGES.emotion),
    );
  }

  if (analysisSettings.photoStyle) {
    updateSection(
      "photoStyle",
      existing.photoStyle
        ? renderPhotoStyleResults(existing.photoStyle)
        : sectionLoadingHtml(SECTION_LOADING_MESSAGES.photoStyle),
    );
  }
}

async function runPartialAnalysis(image, changed) {
  const { analysisSettings, parameters } = getSettings();
  const toggles = changed.toggles ?? [];
  const params = changed.parameters ?? [];
  const existing = getAnalysisResult(image.id) ?? {};
  const analysisResult = {
    ...existing,
    analyzedAt: new Date().toISOString(),
  };

  refreshResultsPanel(analysisSettings);
  showStatusBar("Updating analysis…");

  for (const toggleKey of toggles) {
    if (!analysisSettings[toggleKey]) {
      if (toggleKey === "objects") {
        analysisResult.objects = null;
        currentObjectResults = [];
        clearBoundingBoxes(image.id);
      } else if (toggleKey === "color") {
        analysisResult.colors = null;
        currentColors = [];
      } else if (toggleKey === "caption") {
        analysisResult.caption = null;
      } else if (toggleKey === "composition") {
        analysisResult.composition = null;
      } else if (toggleKey === "emotion") {
        analysisResult.emotion = null;
      } else if (toggleKey === "photoStyle") {
        analysisResult.photoStyle = null;
      }
    }
  }

  const runObjects =
    analysisSettings.objects &&
    (toggles.includes("objects") ||
      params.some((param) => ["confidence", "maxObjects"].includes(param)));

  const runColor =
    analysisSettings.color &&
    (toggles.includes("color") || params.includes("colorsToExtract"));

  const runCaption = analysisSettings.caption && toggles.includes("caption");
  const runComposition =
    analysisSettings.composition && toggles.includes("composition");
  const runEmotion = analysisSettings.emotion && toggles.includes("emotion");
  const runPhotoStyle =
    analysisSettings.photoStyle && toggles.includes("photoStyle");

  const canvasTasks = [];

  if (runColor) {
    updateSection("color", sectionLoadingHtml(SECTION_LOADING_MESSAGES.color));
    setStatusMessage("Analyzing colors…");
    canvasTasks.push(
      extractColors(image.src, parameters.colorsToExtract)
        .then((colors) => {
          currentColors = colors;
          analysisResult.colors = colors;
          renderColorStrip(image.id, colors);
          updateSection("color", renderColorResults(colors));
          setStatusMessage("Color analysis complete");
        })
        .catch(() => {
          updateSection(
            "color",
            "<p class=\"deep-analysis__muted\">Color analysis failed.</p>",
          );
        }),
    );
  }

  if (runComposition) {
    updateSection(
      "composition",
      sectionLoadingHtml(SECTION_LOADING_MESSAGES.composition),
    );
    setStatusMessage("Analyzing composition…");
    canvasTasks.push(
      analyzeComposition(image.src)
        .then((composition) => {
          analysisResult.composition = composition;
          updateSection("composition", renderCompositionResults(composition));
          setStatusMessage("Composition analysis complete");
        })
        .catch(() => {
          updateSection(
            "composition",
            "<p class=\"deep-analysis__muted\">Composition analysis failed.</p>",
          );
        }),
    );
  }

  if (canvasTasks.length) {
    await Promise.all(canvasTasks);
    refreshDataViewIfActive(analysisResult);
  }

  const modelTasks = [];

  if (runObjects) {
    updateSection("objects", sectionLoadingHtml(SECTION_LOADING_MESSAGES.objects));
    setStatusMessage("Loading object detection model…");
    modelTasks.push(
      detectObjects(image.src, {
        threshold: parameters.confidence,
        maxObjects: parameters.maxObjects,
      })
        .then((objects) => {
          currentObjectResults = objects;
          analysisResult.objects = objects;

          renderDeepBoundingBoxes(image.id, objects);

          updateSection("objects", formatObjectResults(objects));
          setStatusMessage("Object detection complete");
        })
        .catch(() => {
          updateSection(
            "objects",
            "<p class=\"deep-analysis__muted\">Object detection failed.</p>",
          );
        }),
    );
  }

  if (runCaption) {
    updateSection("caption", sectionLoadingHtml(SECTION_LOADING_MESSAGES.caption));
    setStatusMessage("Loading caption model…");
    modelTasks.push(
      generateCaption(image.src)
        .then((caption) => {
          analysisResult.caption = caption;
          updateGalleryCaption(image.id, caption);
          updateSection("caption", renderCaptionResult(caption));
          setStatusMessage("Caption complete");
        })
        .catch(() => {
          updateSection(
            "caption",
            "<p class=\"deep-analysis__muted\">Caption unavailable.</p>",
          );
        }),
    );
  }

  if (modelTasks.length) {
    await Promise.all(modelTasks);
    refreshDataViewIfActive(analysisResult);
  }

  if (runEmotion) {
    updateSection("emotion", sectionLoadingHtml(SECTION_LOADING_MESSAGES.emotion));
    const objectResults = analysisResult.objects ?? currentObjectResults ?? [];

    if (shouldRunEmotion(objectResults)) {
      setStatusMessage("Loading emotion detection model…");
      try {
        const emotionResults = await detectEmotion(image.src);
        analysisResult.emotion = emotionResults;
        updateSection("emotion", renderEmotionResults(emotionResults));
        setStatusMessage("Emotion detection complete");
      } catch {
        updateSection(
          "emotion",
          "<p class=\"deep-analysis__muted\">Emotion detection failed.</p>",
        );
      }
    } else {
      analysisResult.emotion = {
        primaryEmotion: "No face detected",
        primaryScore: 0,
        allEmotions: [],
      };
      updateSection(
        "emotion",
        "<p class=\"deep-analysis__muted\">No person detected — emotion analysis skipped.</p>",
      );
      setStatusMessage("Emotion analysis skipped");
    }
  }

  if (runPhotoStyle) {
    updateSection(
      "photoStyle",
      sectionLoadingHtml(SECTION_LOADING_MESSAGES.photoStyle),
    );
    setStatusMessage("Loading scene classification model…");
    try {
      const photoStyle = await analyzePhotoStyle(image.src);
      analysisResult.photoStyle = photoStyle;
      updateSection("photoStyle", renderPhotoStyleResults(photoStyle));
      setStatusMessage("Photo style analysis complete");
    } catch {
      updateSection(
        "photoStyle",
        "<p class=\"deep-analysis__muted\">Photo style analysis failed.</p>",
      );
    }
  }

  storeAnalysisResult(image.id, analysisResult);
  refreshDataViewIfActive(analysisResult);
  hideStatusBar();
}

function handleSettingsChanged(event) {
  if (!deepView || !currentImage) {
    return;
  }

  runPartialAnalysis(currentImage, event.detail.changed ?? {});
}

window.addEventListener("settings-changed", handleSettingsChanged);

window.addEventListener("model-status-change", (event) => {
  if (!deepView) {
    return;
  }

  const { modelName, status } = event.detail;
  const label = MODEL_LABELS[modelName];

  if (!label) {
    return;
  }

  if (status === "loading") {
    setStatusMessage(`Loading ${label} model…`);
  }
});

function setActiveTab(tabName) {
  activeTab = tabName;

  const tabs = deepView?.querySelectorAll(".deep-analysis__tab");

  for (const tab of tabs ?? []) {
    tab.classList.toggle(
      "deep-analysis__tab--active",
      tab.dataset.tab === tabName,
    );
  }

  if (tabName === "data" && currentImage) {
    showDataView(
      currentImage.id,
      getAnalysisResult(currentImage.id) ?? {},
    );
  } else {
    hideDataView();
    applyDeepOverlayPreferences();
  }
}

function buildResultsSections(analysisSettings) {
  const sections = [];

  if (analysisSettings.objects) {
    sections.push("objects");
  }
  if (analysisSettings.color) {
    sections.push("color");
  }
  if (analysisSettings.caption) {
    sections.push("caption");
  }
  if (analysisSettings.composition) {
    sections.push("composition");
  }
  if (analysisSettings.emotion) {
    sections.push("emotion");
  }
  if (analysisSettings.photoStyle) {
    sections.push("photoStyle");
  }

  return sections
    .map(
      (key) =>
        `<section class="deep-analysis__section" data-section="${key}">
          <h3 class="deep-analysis__section-title">${SECTION_LABELS[key]}</h3>
          <div class="deep-analysis__section-content">${sectionLoadingHtml(SECTION_LOADING_MESSAGES[key])}</div>
        </section>`,
    )
    .join("");
}

function buildDeepAnalysisLayout(image, analysisSettings) {
  deepView = document.createElement("div");
  deepView.id = "deep-analysis-view";
  deepView.className = "deep-analysis";

  deepView.innerHTML = `
    <div class="deep-analysis__header">
      <button type="button" class="btn btn--secondary deep-analysis__back" id="btn-back-to-gallery">Back to gallery</button>
      <h2 class="deep-analysis__filename">${image.name}</h2>
      <button type="button" class="btn btn--secondary deep-analysis__export" id="btn-export-deep">Export report</button>
    </div>
    <div class="deep-analysis__body">
      <div class="deep-analysis__visual">
        <div class="deep-analysis__tabs" role="tablist" aria-label="Analysis view">
          <button type="button" class="deep-analysis__tab deep-analysis__tab--active" data-tab="image" role="tab">Image view</button>
          <button type="button" class="deep-analysis__tab" data-tab="data" role="tab">Data view</button>
        </div>
        <div class="deep-analysis__status-bar hidden" id="deep-analysis-status-bar" role="status" aria-live="polite"></div>
        <div class="deep-analysis__overlay-toggles" id="deep-analysis-overlay-toggles">
          <button type="button" class="overlay-toggle overlay-toggle--active" data-overlay="boxes" aria-pressed="true">Boxes</button>
          <button type="button" class="overlay-toggle overlay-toggle--active" data-overlay="labels" aria-pressed="true">Labels</button>
          <button type="button" class="overlay-toggle overlay-toggle--active" data-overlay="face" aria-pressed="true">Face</button>
        </div>
        <div class="deep-analysis__panel deep-analysis__panel--image-view">
          <div
            class="deep-analysis__image-wrap"
            data-image-id="${image.id}"
          >
            <img
              class="deep-analysis__image"
              src="${image.src}"
              alt="${image.name}"
            >
          </div>
        </div>
        <div
          class="deep-analysis__panel deep-analysis__panel--data-view hidden"
          id="${DEEP_DATA_VIEW_CONTAINER_ID}"
        ></div>
      </div>
      <aside class="deep-analysis__results" aria-label="Analysis results">
        ${buildResultsSections(analysisSettings)}
      </aside>
    </div>
  `;

  deepView.querySelector("#btn-back-to-gallery").addEventListener("click", () => {
    returnToGallery();
  });

  deepView.querySelector("#btn-export-deep").addEventListener("click", () => {
    if (!currentImage) {
      return;
    }

    exportSingleImageReport(
      currentImage,
      getAnalysisResult(currentImage.id),
    );
  });

  for (const tab of deepView.querySelectorAll(".deep-analysis__tab")) {
    tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
  }

  wireOverlayToggleButtons(
    deepView.querySelector("#deep-analysis-overlay-toggles"),
    () => applyDeepOverlayPreferences(),
  );

  const refImage = deepView.querySelector(".deep-analysis__image");
  if (refImage) {
    refImage.addEventListener("load", () => {
      initDataView(
        DEEP_DATA_VIEW_CONTAINER_ID,
        image.id,
        getAnalysisResult(image.id) ?? {},
      );

      if (activeTab === "data") {
        showDataView(
          image.id,
          getAnalysisResult(image.id) ?? {},
        );
      }
    });
  }

  initDataView(DEEP_DATA_VIEW_CONTAINER_ID, image.id, {});

  return deepView;
}

export function returnToGallery() {
  if (currentImage) {
    clearBoundingBoxes(currentImage.id);
  }

  hideStatusBar();

  if (deepView) {
    deepView.remove();
    deepView = null;
  }

  currentImage = null;
  currentObjectResults = [];
  currentColors = [];
  activeTab = "image";

  const galleryView = document.getElementById("gallery-view");
  if (galleryView) {
    galleryView.classList.remove("hidden");
  }
}

export async function runAnalysis(image) {
  const { analysisSettings, parameters } = getSettings();
  const existing = getAnalysisResult(image.id) ?? {};
  const analysisResult = {
    caption: existing.caption ?? null,
    colors: existing.colors ?? null,
    objects: existing.objects ?? null,
    composition: existing.composition ?? null,
    emotion: existing.emotion ?? null,
    photoStyle: existing.photoStyle ?? null,
    analyzedAt: new Date().toISOString(),
  };

  currentObjectResults = existing.objects ?? [];
  currentColors = existing.colors ?? [];

  initializeSectionLoadingStates(analysisSettings, existing);
  showStatusBar("Starting analysis…");

  if (existing.colors && analysisSettings.color) {
    renderColorStrip(image.id, existing.colors);
    updateSection("color", renderColorResults(existing.colors));
  }

  if (existing.composition && analysisSettings.composition) {
    updateSection("composition", renderCompositionResults(existing.composition));
  }

  if (existing.objects && analysisSettings.objects) {
    renderDeepBoundingBoxes(image.id, existing.objects);
    updateSection("objects", formatObjectResults(existing.objects));
  }

  if (existing.caption && analysisSettings.caption) {
    updateSection("caption", renderCaptionResult(existing.caption));
  }

  if (existing.emotion && analysisSettings.emotion) {
    updateSection("emotion", renderEmotionResults(existing.emotion));
  }

  if (existing.photoStyle && analysisSettings.photoStyle) {
    updateSection("photoStyle", renderPhotoStyleResults(existing.photoStyle));
  }

  // Phase 1: Canvas analyses first (instant)
  const canvasTasks = [];

  if (analysisSettings.color && !existing.colors) {
    setStatusMessage("Analyzing colors…");
    canvasTasks.push(
      extractColors(image.src, parameters.colorsToExtract)
        .then((colors) => {
          currentColors = colors;
          analysisResult.colors = colors;
          renderColorStrip(image.id, colors);
          updateSection("color", renderColorResults(colors));
          setStatusMessage("Color analysis complete");
        })
        .catch(() => {
          updateSection(
            "color",
            "<p class=\"deep-analysis__muted\">Color analysis failed.</p>",
          );
        }),
    );
  }

  if (analysisSettings.composition && !existing.composition) {
    setStatusMessage("Analyzing composition…");
    canvasTasks.push(
      analyzeComposition(image.src)
        .then((composition) => {
          analysisResult.composition = composition;
          updateSection("composition", renderCompositionResults(composition));
          setStatusMessage("Composition analysis complete");
        })
        .catch(() => {
          updateSection(
            "composition",
            "<p class=\"deep-analysis__muted\">Composition analysis failed.</p>",
          );
        }),
    );
  }

  if (canvasTasks.length) {
    await Promise.all(canvasTasks);
    refreshDataViewIfActive(analysisResult);
  }

  // Phase 2: Independent AI analyses in parallel (objects + caption)
  const modelTasks = [];

  if (analysisSettings.objects && !existing.objects) {
    updateSection("objects", sectionLoadingHtml(SECTION_LOADING_MESSAGES.objects));
    setStatusMessage("Loading object detection model…");

    modelTasks.push(
      detectObjects(image.src, {
        threshold: parameters.confidence,
        maxObjects: parameters.maxObjects,
      })
        .then((objects) => {
          currentObjectResults = objects;
          analysisResult.objects = objects;

          renderDeepBoundingBoxes(image.id, objects);

          updateSection("objects", formatObjectResults(objects));
          setStatusMessage("Object detection complete");
          return objects;
        })
        .catch(() => {
          updateSection(
            "objects",
            "<p class=\"deep-analysis__muted\">Object detection failed.</p>",
          );
          return null;
        }),
    );
  }

  if (analysisSettings.caption && !existing.caption) {
    updateSection("caption", sectionLoadingHtml(SECTION_LOADING_MESSAGES.caption));
    setStatusMessage("Loading caption model…");

    modelTasks.push(
      generateCaption(image.src)
        .then((caption) => {
          analysisResult.caption = caption;
          updateGalleryCaption(image.id, caption);
          updateSection("caption", renderCaptionResult(caption));
          setStatusMessage("Caption complete");
        })
        .catch(() => {
          updateSection(
            "caption",
            "<p class=\"deep-analysis__muted\">Caption unavailable.</p>",
          );
        }),
    );
  }

  if (analysisSettings.photoStyle && !existing.photoStyle) {
    updateSection(
      "photoStyle",
      sectionLoadingHtml(SECTION_LOADING_MESSAGES.photoStyle),
    );
    setStatusMessage("Analysing style…");

    modelTasks.push(
      analyzePhotoStyle(image.src)
        .then((photoStyle) => {
          analysisResult.photoStyle = photoStyle;
          updateSection("photoStyle", renderPhotoStyleResults(photoStyle));
          setStatusMessage("Photo style analysis complete");
        })
        .catch(() => {
          updateSection(
            "photoStyle",
            "<p class=\"deep-analysis__muted\">Photo style analysis failed.</p>",
          );
        }),
    );
  }

  let objectResults = currentObjectResults;
  if (modelTasks.length) {
    await Promise.all(modelTasks);
    objectResults = currentObjectResults;
    refreshDataViewIfActive(analysisResult);
  }

  // Phase 3: Emotion depends on object detection results
  if (analysisSettings.emotion && !existing.emotion) {
    updateSection("emotion", sectionLoadingHtml(SECTION_LOADING_MESSAGES.emotion));
    const objectsForEmotion = objectResults ?? currentObjectResults ?? [];

    if (shouldRunEmotion(objectsForEmotion)) {
      setStatusMessage("Loading emotion detection model…");
      try {
        const emotionResults = await detectEmotion(image.src);
        analysisResult.emotion = emotionResults;
        updateSection("emotion", renderEmotionResults(emotionResults));
        setStatusMessage("Emotion detection complete");
      } catch {
        updateSection(
          "emotion",
          "<p class=\"deep-analysis__muted\">Emotion detection failed.</p>",
        );
      }
    } else {
      analysisResult.emotion = {
        primaryEmotion: "No face detected",
        primaryScore: 0,
        allEmotions: [],
      };
      updateSection(
        "emotion",
        "<p class=\"deep-analysis__muted\">No person detected — emotion analysis skipped.</p>",
      );
      setStatusMessage("Emotion analysis skipped");
    }
  }

  storeAnalysisResult(image.id, analysisResult);
  refreshDataViewIfActive(analysisResult);
  hideStatusBar();
}

export function openDeepAnalysis(imageId, images) {
  const image = images.find(
    (item) => String(item.id) === String(imageId),
  );

  if (!image) {
    return;
  }

  const { analysisSettings } = getSettings();
  const mainContent = document.getElementById("main-content");
  const galleryView = document.getElementById("gallery-view");

  if (!mainContent) {
    return;
  }

  if (galleryView) {
    galleryView.classList.add("hidden");
  }

  if (deepView) {
    deepView.remove();
  }

  currentImage = image;
  currentObjectResults = [];
  currentColors = [];
  activeTab = "image";

  deepView = buildDeepAnalysisLayout(image, analysisSettings);
  mainContent.appendChild(deepView);

  runAnalysis(image);
}
