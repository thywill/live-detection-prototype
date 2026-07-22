import {
  detectObjects,
  formatObjectScore,
  groupObjectsByLabel,
  renderBoundingBoxes,
} from "../analysis/objects.js";
import { extractColors } from "../analysis/color.js";
import { generateCaption } from "../analysis/caption.js";
import { analyzeComposition } from "../analysis/composition.js";
import { detectEmotion, shouldRunEmotion } from "../analysis/emotion.js";
import { getSettings } from "./sidebar.js";
import { returnToGallery } from "./deep.js";
import {
  analysisStore,
  exportToCSV,
  getAnalysisResult,
  storeAnalysisResult,
} from "../utils/export.js";
import {
  applyOverlayClasses,
  applyOverlayClassesToAll,
  wireOverlayToggleButtons,
} from "../utils/overlays.js";

let compareView = null;
let comparedImages = [];
let scatterResizeTimer = null;
let scatterResizeHandler = null;

const SCATTER_CANVAS_HEIGHT = 420;
const SCATTER_PADDING = {
  left: 48,
  right: 20,
  top: 20,
  bottom: 48,
};
const SCATTER_TICKS = [0, 25, 50, 75, 100];

function parseHexColor(hex) {
  const sanitized = String(hex || "").replace("#", "");
  if (sanitized.length !== 6) {
    return { r: 128, g: 128, b: 128 };
  }

  return {
    r: parseInt(sanitized.slice(0, 2), 16),
    g: parseInt(sanitized.slice(2, 4), 16),
    b: parseInt(sanitized.slice(4, 6), 16),
  };
}

function getScatterColor(colors) {
  if (!colors?.length) {
    return "#999999";
  }

  let warmScore = 0;
  let coolScore = 0;

  for (const color of colors) {
    const rgb = color.rgb ?? parseHexColor(color.hex);
    const weight = Number(color.percentage || 0) / 100;
    const yellowish = Math.min(rgb.r, rgb.g);
    warmScore += (rgb.r + yellowish) * weight;
    coolScore += (rgb.b + rgb.g) * weight;
  }

  if (warmScore > coolScore + 10) {
    return "#E8843A";
  }

  if (coolScore > warmScore + 10) {
    return "#4A90D9";
  }

  return "#999999";
}

function mapScatterX(value, plotWidth) {
  return SCATTER_PADDING.left + (value / 100) * plotWidth;
}

function mapScatterY(value, plotHeight) {
  return SCATTER_PADDING.top + ((100 - value) / 100) * plotHeight;
}

function buildScatterPoints(images) {
  return images.map((image) => {
    const results = getAnalysisResult(image.id) ?? {};
    const composition = results.composition ?? null;
    const objectLabels = (results.objects ?? [])
      .map((object) => object.label)
      .filter((label, index, arr) => arr.indexOf(label) === index)
      .slice(0, 3);
    const hasComposition =
      typeof composition?.brightnessScore === "number" &&
      typeof composition?.contrastScore === "number";

    return {
      image,
      caption: results.caption || "Caption unavailable",
      objectLabels,
      brightness: hasComposition ? composition.brightnessScore : 50,
      contrast: hasComposition ? composition.contrastScore : 50,
      color: getScatterColor(results.colors),
      hasData: hasComposition,
      drawX: 0,
      drawY: 0,
    };
  });
}

function drawScatterAxes(ctx, width, height, plotWidth, plotHeight) {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#222222";
  ctx.lineWidth = 1;

  for (const tick of SCATTER_TICKS) {
    const x = mapScatterX(tick, plotWidth);
    const y = mapScatterY(tick, plotHeight);

    ctx.beginPath();
    ctx.moveTo(x, SCATTER_PADDING.top);
    ctx.lineTo(x, height - SCATTER_PADDING.bottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(SCATTER_PADDING.left, y);
    ctx.lineTo(width - SCATTER_PADDING.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#666666";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (const tick of SCATTER_TICKS) {
    const x = mapScatterX(tick, plotWidth);
    ctx.fillText(String(tick), x, height - SCATTER_PADDING.bottom + 6);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of SCATTER_TICKS) {
    const y = mapScatterY(tick, plotHeight);
    ctx.fillText(String(tick), SCATTER_PADDING.left - 8, y);
  }

  ctx.fillStyle = "#888888";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Brightness", SCATTER_PADDING.left + plotWidth / 2, height - 24);

  ctx.save();
  ctx.translate(16, SCATTER_PADDING.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Contrast", 0, 0);
  ctx.restore();
}

function drawScatterPoints(ctx, points, plotWidth, plotHeight) {
  for (const point of points) {
    point.drawX = mapScatterX(point.brightness, plotWidth);
    point.drawY = mapScatterY(point.contrast, plotHeight);

    if (!point.hasData) {
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#777777";
      ctx.arc(point.drawX, point.drawY, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.beginPath();
      ctx.fillStyle = point.color;
      ctx.arc(point.drawX, point.drawY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
  }
}

function hideScatterTooltip() {
  const tooltip = compareView?.querySelector("#scatter-tooltip");
  if (tooltip) {
    tooltip.style.display = "none";
  }
}

function renderScatterTooltip(point, canvas, wrap) {
  const tooltip = compareView?.querySelector("#scatter-tooltip");
  if (!tooltip) {
    return;
  }

  const shortCaption =
    point.caption.length > 55 ? `${point.caption.slice(0, 54)}…` : point.caption;
  const objectsHtml = point.objectLabels.length
    ? point.objectLabels
      .map(
        (label) =>
          `<span class="scatter-tooltip__object-pill">${escapeHtml(label)}</span>`,
      )
      .join("")
    : `<p class="scatter-tooltip__objects-empty">No objects detected</p>`;

  tooltip.style.display = "block";
  tooltip.innerHTML = `
    <canvas class="scatter-tooltip__thumb" width="120" height="80"></canvas>
    <div class="scatter-tooltip__objects">${objectsHtml}</div>
    <p class="scatter-tooltip__metrics">Brightness ${point.brightness} · Contrast ${point.contrast}</p>
    <p class="scatter-tooltip__caption">${escapeHtml(shortCaption)}</p>
  `;

  const thumb = tooltip.querySelector(".scatter-tooltip__thumb");
  const tctx = thumb.getContext("2d");
  const img = new Image();
  img.onload = () => {
    const srcRatio = img.width / img.height;
    const dstRatio = thumb.width / thumb.height;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (srcRatio > dstRatio) {
      sw = img.height * dstRatio;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / dstRatio;
      sy = (img.height - sh) / 2;
    }

    tctx.drawImage(img, sx, sy, sw, sh, 0, 0, thumb.width, thumb.height);
  };
  img.src = point.image.src;

  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const dotX = canvasRect.left - wrapRect.left + point.drawX;
  const dotY = canvasRect.top - wrapRect.top + point.drawY;
  const preferredLeft = dotX + 18;
  const fitsRight = preferredLeft + tooltipRect.width <= wrapRect.width - 8;
  const left = fitsRight
    ? preferredLeft
    : Math.max(8, dotX - tooltipRect.width - 18);
  const unclampedTop = dotY - tooltipRect.height / 2;
  const top = Math.min(
    Math.max(8, unclampedTop),
    Math.max(8, wrapRect.height - tooltipRect.height - 8),
  );

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function drawScatterPlot(images) {
  if (!compareView) {
    return;
  }

  const canvas = compareView.querySelector("#scatter-plot");
  const wrap = compareView.querySelector(".scatter-wrap");
  if (!canvas || !wrap) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(320, Math.round(wrap.clientWidth));
  const cssHeight = SCATTER_CANVAS_HEIGHT;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = cssWidth;
  const height = cssHeight;
  const plotWidth = width - SCATTER_PADDING.left - SCATTER_PADDING.right;
  const plotHeight = height - SCATTER_PADDING.top - SCATTER_PADDING.bottom;
  const points = buildScatterPoints(images);

  drawScatterAxes(ctx, width, height, plotWidth, plotHeight);
  drawScatterPoints(ctx, points, plotWidth, plotHeight);

  function onMove(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let hovered = null;
    for (const point of points) {
      const distance = Math.hypot(point.drawX - x, point.drawY - y);
      if (distance <= 14) {
        hovered = point;
        break;
      }
    }

    if (hovered) {
      canvas.style.cursor = "pointer";
      renderScatterTooltip(hovered, canvas, wrap);
    } else {
      canvas.style.cursor = "default";
      hideScatterTooltip();
    }
  }

  canvas.onmousemove = onMove;
  canvas.onmouseleave = () => {
    canvas.style.cursor = "default";
    hideScatterTooltip();
  };
}

function scheduleScatterRender() {
  if (!compareView || comparedImages.length === 0) {
    return;
  }

  window.requestAnimationFrame(() => {
    drawScatterPlot(comparedImages);
  });
}

function registerScatterResizeHandler() {
  if (scatterResizeHandler) {
    window.removeEventListener("resize", scatterResizeHandler);
  }

  scatterResizeHandler = () => {
    if (scatterResizeTimer) {
      window.clearTimeout(scatterResizeTimer);
    }

    scatterResizeTimer = window.setTimeout(() => {
      scheduleScatterRender();
    }, 140);
  };

  window.addEventListener("resize", scatterResizeHandler);
}

function setCompareActiveTab(tabName) {
  if (!compareView) {
    return;
  }

  const tabs = compareView.querySelectorAll(".deep-analysis__tab");
  const tablePanel = compareView.querySelector("#compare-table-panel");
  const visualPanel = compareView.querySelector("#compare-visual-panel");

  for (const tab of tabs) {
    tab.classList.toggle("deep-analysis__tab--active", tab.dataset.tab === tabName);
  }

  if (tablePanel) {
    tablePanel.classList.toggle("hidden", tabName !== "table");
  }

  if (visualPanel) {
    visualPanel.classList.toggle("hidden", tabName !== "visual");
  }

  if (tabName === "visual") {
    scheduleScatterRender();
  } else {
    hideScatterTooltip();
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findSharedObjectLabels(resultsByImage) {
  const labelImageCounts = new Map();

  for (const results of resultsByImage) {
    const labelsInImage = new Set(
      results.objects?.map((object) => object.label.toLowerCase()) ?? [],
    );

    for (const label of labelsInImage) {
      labelImageCounts.set(label, (labelImageCounts.get(label) || 0) + 1);
    }
  }

  return new Set(
    [...labelImageCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([label]) => label),
  );
}

function renderColorMetric(colors) {
  if (!colors?.length) {
    return "<p class=\"compare-metric__empty\">No colors detected.</p>";
  }

  const topColors = colors.slice(0, 3);
  const colorList = topColors
    .map(
      (color) =>
        `<li class="compare-color-item">
          <span class="compare-color-item__swatch" style="background-color: ${color.hex}"></span>
          <span class="compare-color-item__hex">${color.hex}</span>
          <span class="compare-color-item__percentage">${color.percentage}%</span>
        </li>`,
    )
    .join("");

  return `<ul class="compare-color-list">${colorList}</ul>`;
}

function updateColumnColorStrip(imageId, colors) {
  if (!compareView) {
    return;
  }

  const strip = compareView.querySelector(
    `.compare-column[data-image-id="${String(imageId)}"] .compare-column__color-strip`,
  );

  if (!strip) {
    return;
  }

  strip.replaceChildren();

  if (!colors?.length) {
    return;
  }

  for (const color of colors) {
    const segment = document.createElement("div");
    segment.className = "compare-column__color-segment";
    segment.style.backgroundColor = color.hex;
    segment.style.flexGrow = String(color.percentage);
    segment.style.flexBasis = "0";
    strip.appendChild(segment);
  }
}

function renderObjectsMetric(objects, sharedLabels) {
  if (!objects?.length) {
    return "<p class=\"compare-metric__empty\">No objects detected.</p>";
  }

  const groupedObjects = groupObjectsByLabel(objects);
  const items = groupedObjects
    .map((group) => {
      const isShared = sharedLabels.has(group.label.toLowerCase());
      const countLabel = group.count > 1 ? ` (${group.count})` : "";

      return `<li class="compare-object-item${isShared ? " compare-object-item--shared" : ""}">
        <span class="compare-object-item__label">${escapeHtml(group.label)}${countLabel} avg: ${formatObjectScore(group.avgScore)}</span>
      </li>`;
    })
    .join("");

  return `<ul class="compare-object-list">${items}</ul>`;
}

function renderCompositionMetric(composition) {
  if (!composition) {
    return "<p class=\"compare-metric__empty\">Composition unavailable.</p>";
  }

  return `
    <ul class="compare-composition-list">
      <li><span>Orientation</span><strong>${escapeHtml(composition.orientation)}</strong></li>
      <li><span>Brightness</span><strong>${composition.brightnessScore}</strong></li>
      <li><span>Contrast</span><strong>${composition.contrastScore}</strong></li>
      <li><span>Lighting</span><strong>${escapeHtml(composition.lightingType)}</strong></li>
    </ul>
  `;
}

function renderEmotionMetric(emotion) {
  if (!emotion) {
    return "<p class=\"compare-metric__empty\">Emotion unavailable.</p>";
  }

  if (
    emotion.primaryEmotion === "No face detected" ||
    !emotion.allEmotions?.length
  ) {
    return "<p class=\"compare-metric__empty\">No face detected.</p>";
  }

  return `
    <p class="compare-emotion-primary">${escapeHtml(emotion.primaryEmotion)}</p>
    <p class="compare-emotion-score">Confidence: ${emotion.primaryScore}</p>
  `;
}

function buildMetricRow(label, contentHtml, metricKey) {
  return `
    <div class="compare-metric" data-metric="${metricKey}">
      <span class="compare-metric__label">${label}</span>
      <div class="compare-metric__content">${contentHtml}</div>
    </div>
  `;
}

function buildColumnMetrics(image, results, sharedLabels, analysisSettings) {
  const rows = [];

  if (analysisSettings.caption) {
    rows.push(
      buildMetricRow(
        "Caption",
        `<p class="compare-caption">${escapeHtml(results.caption ?? "Analysing...")}</p>`,
        "caption",
      ),
    );
  }

  if (analysisSettings.color) {
    rows.push(
      buildMetricRow(
        "Dominant colors",
        results.colors
          ? renderColorMetric(results.colors)
          : "<p class=\"compare-metric__empty\">Analysing...</p>",
        "color",
      ),
    );
  }

  if (analysisSettings.objects) {
    rows.push(
      buildMetricRow(
        "Objects found",
        results.objects
          ? renderObjectsMetric(results.objects, sharedLabels)
          : "<p class=\"compare-metric__empty\">Analysing...</p>",
        "objects",
      ),
    );
  }

  if (analysisSettings.composition) {
    rows.push(
      buildMetricRow(
        "Composition",
        results.composition
          ? renderCompositionMetric(results.composition)
          : "<p class=\"compare-metric__empty\">Analysing...</p>",
        "composition",
      ),
    );
  }

  if (analysisSettings.emotion) {
    rows.push(
      buildMetricRow(
        "Emotion",
        results.emotion
          ? renderEmotionMetric(results.emotion)
          : "<p class=\"compare-metric__empty\">Analysing...</p>",
        "emotion",
      ),
    );
  }

  return rows.join("");
}

function buildCompareColumn(image, analysisSettings) {
  const column = document.createElement("article");
  column.className = "compare-column";
  column.dataset.imageId = String(image.id);

  column.innerHTML = `
    <div class="compare-column__header">
      <div class="compare-column__media">
        <img class="compare-column__thumb" src="${image.src}" alt="${escapeHtml(image.name)}">
        <div class="compare-column__color-strip" aria-hidden="true"></div>
      </div>
      <p class="compare-column__name">${escapeHtml(image.name)}</p>
    </div>
    <div class="compare-column__metrics">
      ${buildColumnMetrics(image, {}, new Set(), analysisSettings)}
    </div>
  `;

  return column;
}

function hasCompleteStoredResults(stored, analysisSettings) {
  if (!stored || Object.keys(stored).length === 0) {
    return false;
  }

  if (analysisSettings.objects && stored.objects == null) {
    return false;
  }

  if (analysisSettings.color && !stored.colors) {
    return false;
  }

  if (analysisSettings.caption && !stored.caption) {
    return false;
  }

  if (analysisSettings.composition && !stored.composition) {
    return false;
  }

  if (analysisSettings.emotion && !stored.emotion) {
    return false;
  }

  return true;
}

function renderCompareColumnBoxes(image, objects) {
  if (!compareView || !objects?.length) {
    return;
  }

  const column = compareView.querySelector(
    `.compare-column[data-image-id="${String(image.id)}"]`,
  );
  const media = column?.querySelector(".compare-column__media");
  const thumb = column?.querySelector(".compare-column__thumb");

  if (!media || !thumb) {
    return;
  }

  renderBoundingBoxes(image.id, objects, true, media, thumb);
  applyOverlayClasses(media);
}

function populateCompareFromCache(images, analysisSettings) {
  const resultsByImage = images.map((image) => getAnalysisResult(image.id) ?? {});
  const sharedLabels = findSharedObjectLabels(resultsByImage);

  images.forEach((image, index) => {
    const stored = resultsByImage[index];

    if (!stored || Object.keys(stored).length === 0) {
      return;
    }

    updateColumnMetrics(image, stored, sharedLabels, analysisSettings);

    if (stored.objects?.length) {
      renderCompareColumnBoxes(image, stored.objects);
    }

    if (stored.colors) {
      updateColumnColorStrip(image.id, stored.colors);
    }
  });

  return resultsByImage;
}

async function analyzeImageForCompare(image, analysisSettings, parameters) {
  const results = {
    caption: null,
    colors: null,
    objects: null,
    composition: null,
    emotion: null,
  };

  if (analysisSettings.objects) {
    results.objects = await detectObjects(image.src, {
      threshold: parameters.confidence,
      maxObjects: parameters.maxObjects,
    });
  }

  const parallelTasks = [];

  if (analysisSettings.color) {
    parallelTasks.push(
      extractColors(image.src, parameters.colorsToExtract).then((colors) => {
        results.colors = colors;
      }),
    );
  }

  if (analysisSettings.caption) {
    parallelTasks.push(
      generateCaption(image.src).then((caption) => {
        results.caption = caption;
      }),
    );
  }

  if (parallelTasks.length) {
    await Promise.all(parallelTasks);
  }

  if (analysisSettings.composition) {
    results.composition = await analyzeComposition(image.src);
  }

  if (
    analysisSettings.emotion &&
    shouldRunEmotion(results.objects ?? [])
  ) {
    results.emotion = await detectEmotion(image.src);
  } else if (analysisSettings.emotion) {
    results.emotion = {
      primaryEmotion: "No face detected",
      primaryScore: 0,
      allEmotions: [],
    };
  }

  return results;
}

function updateColumnMetrics(
  image,
  results,
  sharedLabels,
  analysisSettings,
) {
  if (!compareView) {
    return;
  }

  const column = compareView.querySelector(
    `.compare-column[data-image-id="${String(image.id)}"] .compare-column__metrics`,
  );

  if (column) {
    column.innerHTML = buildColumnMetrics(
      image,
      results,
      sharedLabels,
      analysisSettings,
    );
    updateColumnColorStrip(image.id, results.colors);
  }
}

async function runCompareAnalysis(images, analysisSettings, parameters) {
  const resultsByImage = images.map((image) => getAnalysisResult(image.id) ?? {});

  const pendingImages = images.filter(
    (image, index) =>
      !hasCompleteStoredResults(resultsByImage[index], analysisSettings),
  );

  if (pendingImages.length === 0) {
    const sharedLabels = findSharedObjectLabels(resultsByImage);
    images.forEach((image, index) => {
      updateColumnMetrics(
        image,
        resultsByImage[index],
        sharedLabels,
        analysisSettings,
      );
      if (resultsByImage[index].objects?.length) {
        renderCompareColumnBoxes(image, resultsByImage[index].objects);
      }
    });
    scheduleScatterRender();
    return;
  }

  for (const image of pendingImages) {
    const index = images.indexOf(image);
    const freshResults = await analyzeImageForCompare(
      image,
      analysisSettings,
      parameters,
    );
    const results = {
      ...freshResults,
      analyzedAt: new Date().toISOString(),
    };

    resultsByImage[index] = results;
    storeAnalysisResult(image.id, results);
  }

  const sharedLabels = findSharedObjectLabels(resultsByImage);

  images.forEach((image, index) => {
    const results = resultsByImage[index];
    updateColumnMetrics(image, results, sharedLabels, analysisSettings);

    if (results.objects?.length) {
      renderCompareColumnBoxes(image, results.objects);
    }
  });

  scheduleScatterRender();
}

function refreshCompareMetrics() {
  if (!compareView || comparedImages.length === 0) {
    return;
  }

  const { analysisSettings } = getSettings();
  const resultsByImage = comparedImages.map(
    (image) => getAnalysisResult(image.id) ?? {},
  );
  const sharedLabels = findSharedObjectLabels(resultsByImage);

  comparedImages.forEach((image, index) => {
    updateColumnMetrics(
      image,
      resultsByImage[index],
      sharedLabels,
      analysisSettings,
    );
  });

  scheduleScatterRender();
}

function handleCompareSettingsChanged() {
  if (!compareView) {
    return;
  }

  refreshCompareMetrics();
}

window.addEventListener("settings-changed", handleCompareSettingsChanged);

export function returnToGalleryFromCompare() {
  if (compareView) {
    compareView.remove();
    compareView = null;
  }

  if (scatterResizeHandler) {
    window.removeEventListener("resize", scatterResizeHandler);
    scatterResizeHandler = null;
  }
  if (scatterResizeTimer) {
    window.clearTimeout(scatterResizeTimer);
    scatterResizeTimer = null;
  }

  comparedImages = [];

  const galleryView = document.getElementById("gallery-view");
  if (galleryView) {
    galleryView.classList.remove("hidden");
  }
}

export function openCompareView(selectedIds, images) {
  const selectedImages = images.filter((image) =>
    selectedIds.some((id) => String(id) === String(image.id)),
  );

  if (selectedImages.length < 2) {
    return;
  }

  const { analysisSettings, parameters } = getSettings();
  const mainContent = document.getElementById("main-content");
  const galleryView = document.getElementById("gallery-view");

  if (!mainContent) {
    return;
  }

  returnToGallery();
  returnToGalleryFromCompare();

  if (galleryView) {
    galleryView.classList.add("hidden");
  }

  comparedImages = selectedImages;

  compareView = document.createElement("div");
  compareView.id = "compare-view";
  compareView.className = "compare-view";

  compareView.innerHTML = `
    <div class="compare-view__header">
      <button type="button" class="btn btn--secondary compare-view__back" id="btn-back-from-compare">Back to gallery</button>
      <h2 class="compare-view__title">Comparing ${selectedImages.length} images</h2>
      <div class="compare-view__overlay-toggles" id="compare-overlay-toggles">
        <button type="button" class="overlay-toggle overlay-toggle--active" data-overlay="boxes" aria-pressed="true">Boxes</button>
      </div>
      <button type="button" class="btn btn--secondary compare-view__export" id="btn-export-compare-csv">Export CSV</button>
    </div>
    <div class="deep-analysis__tabs compare-view__tabs" role="tablist" aria-label="Comparison view">
      <button type="button" class="deep-analysis__tab deep-analysis__tab--active" data-tab="table" role="tab">Table view</button>
      <button type="button" class="deep-analysis__tab" data-tab="visual" role="tab">Visual space</button>
    </div>
    <div class="compare-view__content">
      <div class="compare-view__panel" id="compare-table-panel">
        <div class="compare-view__scroll">
          <div class="compare-grid"></div>
        </div>
      </div>
      <div class="compare-view__panel hidden" id="compare-visual-panel">
        <div class="scatter-wrap" style="position:relative">
          <canvas id="scatter-plot" height="420"></canvas>
          <div id="scatter-tooltip" class="scatter-tooltip"></div>
        </div>
        <div class="scatter-legend">
          <span class="scatter-legend__item"><span class="scatter-legend__dot" style="background:#E8843A"></span>Warm</span>
          <span class="scatter-legend__item"><span class="scatter-legend__dot" style="background:#4A90D9"></span>Cool</span>
          <span class="scatter-legend__item"><span class="scatter-legend__dot" style="background:#999999"></span>Neutral</span>
        </div>
      </div>
    </div>
  `;

  const grid = compareView.querySelector(".compare-grid");
  grid.style.setProperty(
    "--compare-columns",
    String(selectedImages.length),
  );

  for (const image of selectedImages) {
    grid.appendChild(buildCompareColumn(image, analysisSettings));
  }

  compareView
    .querySelector("#btn-back-from-compare")
    .addEventListener("click", returnToGalleryFromCompare);

  compareView
    .querySelector("#btn-export-compare-csv")
    .addEventListener("click", () => {
      exportToCSV(comparedImages, analysisStore);
    });

  for (const tab of compareView.querySelectorAll(".deep-analysis__tab")) {
    tab.addEventListener("click", () => {
      setCompareActiveTab(tab.dataset.tab);
    });
  }

  mainContent.appendChild(compareView);
  registerScatterResizeHandler();

  populateCompareFromCache(selectedImages, analysisSettings);

  wireOverlayToggleButtons(
    compareView.querySelector("#compare-overlay-toggles"),
    () => {
      applyOverlayClassesToAll(compareView, ".compare-column__media");
    },
  );

  runCompareAnalysis(selectedImages, analysisSettings, parameters);
  setCompareActiveTab("table");
}
