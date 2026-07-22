import { loadModel, getModel } from "../models.js";

const LABEL_COLORS = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#469990",
  "#9a6324",
  "#800000",
  "#808000",
  "#000075",
];

const labelColorCache = new Map();

function hashLabel(label) {
  let hash = 0;

  for (let i = 0; i < label.length; i += 1) {
    hash = (hash << 5) - hash + label.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getLabelColor(label) {
  if (!labelColorCache.has(label)) {
    const index = hashLabel(label) % LABEL_COLORS.length;
    labelColorCache.set(label, LABEL_COLORS[index]);
  }

  return labelColorCache.get(label);
}

function normalizeScore(score) {
  const value = Number(score);
  return Number.isFinite(value) ? value : 0;
}

function formatObjectScore(score) {
  return normalizeScore(score).toFixed(2);
}

function findImageContainers(imageId) {
  const id = String(imageId);
  const containers = [];

  const deepWrap = document.querySelector(
    `.deep-analysis__image-wrap[data-image-id="${id}"]`,
  );
  if (deepWrap) {
    containers.push(deepWrap);
  }

  const dataCanvas = document.querySelector(
    `.deep-analysis__data-canvas[data-image-id="${id}"]`,
  );
  if (dataCanvas) {
    containers.push(dataCanvas);
  }

  const card = document.querySelector(`.gallery-card[data-id="${id}"]`);
  const galleryWrap = card?.querySelector(".gallery-card__image-wrap");
  if (galleryWrap) {
    containers.push(galleryWrap);
  }

  return containers;
}

function findImageContainer(imageId) {
  return findImageContainers(imageId)[0] ?? null;
}

function drawBoundingBoxes(container, results, dimensionSource) {
  const image = dimensionSource ?? container.querySelector("img");
  if (!image || !results?.length) {
    return;
  }

  const existingLayer = container.querySelector(".bounding-boxes");
  if (existingLayer) {
    existingLayer.remove();
  }

  const layer = document.createElement("div");
  layer.className = "bounding-boxes";

  for (const result of results) {
    const percentBox = boxToPercentages(result.box, image);
    if (!percentBox) {
      continue;
    }

    const color = getLabelColor(result.label);
    const isPerson = result.label.toLowerCase() === "person";
    const boxEl = document.createElement("div");
    boxEl.className = "bounding-box";
    if (isPerson) {
      boxEl.classList.add("bounding-box--person");
    }
    boxEl.style.left = `${percentBox.left}%`;
    boxEl.style.top = `${percentBox.top}%`;
    boxEl.style.width = `${percentBox.width}%`;
    boxEl.style.height = `${percentBox.height}%`;
    boxEl.style.borderColor = color;

    const labelEl = document.createElement("span");
    labelEl.className = "bounding-box__label";
    labelEl.textContent = `${result.label} ${formatObjectScore(result.score)}`;
    labelEl.style.backgroundColor = color;

    boxEl.appendChild(labelEl);
    layer.appendChild(boxEl);
  }

  container.appendChild(layer);
}

function boxToPercentages(box, image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    return null;
  }

  const isNormalized =
    box.xmin >= 0 &&
    box.ymin >= 0 &&
    box.xmax <= 1 &&
    box.ymax <= 1;

  if (isNormalized) {
    return {
      left: box.xmin * 100,
      top: box.ymin * 100,
      width: (box.xmax - box.xmin) * 100,
      height: (box.ymax - box.ymin) * 100,
    };
  }

  return {
    left: (box.xmin / width) * 100,
    top: (box.ymin / height) * 100,
    width: ((box.xmax - box.xmin) / width) * 100,
    height: ((box.ymax - box.ymin) / height) * 100,
  };
}

export async function detectObjects(imageSrc, options) {
  const { threshold, maxObjects } = options;

  await loadModel("objectDetector");
  const model = getModel("objectDetector");

  // EXPERIMENT
  const _tObj = performance.now();
  const rawResults = await model(imageSrc, { threshold });
  console.log(
    `[TIMING] objects: ${((performance.now() - _tObj) / 1000).toFixed(2)}s`,
  );
  console.log(
    "[OBJECTS] raw scores:",
    rawResults.map((item) => ({ label: item.label, score: item.score })),
  );

  return rawResults.slice(0, maxObjects).map((item) => ({
    label: item.label,
    score: normalizeScore(item.score),
    box: {
      xmin: item.box.xmin,
      ymin: item.box.ymin,
      xmax: item.box.xmax,
      ymax: item.box.ymax,
    },
  }));
}

export function groupObjectsByLabel(objects) {
  if (!objects?.length) {
    return [];
  }

  const groups = new Map();

  for (const object of objects) {
    const key = object.label.toLowerCase();
    const existing = groups.get(key);
    const detection = {
      label: object.label,
      score: normalizeScore(object.score),
    };

    if (existing) {
      existing.detections.push(detection);
    } else {
      groups.set(key, {
        label: object.label,
        detections: [detection],
      });
    }
  }

  return Array.from(groups.values()).map((group) => {
    const avgScore =
      group.detections.reduce((sum, detection) => sum + detection.score, 0) /
      group.detections.length;

    return {
      label: group.label,
      count: group.detections.length,
      avgScore,
      detections: group.detections,
    };
  });
}

export function clearBoundingBoxes(imageId) {
  for (const container of findImageContainers(imageId)) {
    const layer = container.querySelector(".bounding-boxes");
    if (layer) {
      layer.remove();
    }
  }
}

export function renderBoundingBoxes(
  imageId,
  results,
  showImage,
  targetContainer = null,
  dimensionSource = null,
) {
  if (!showImage || !results?.length) {
    if (targetContainer) {
      const layer = targetContainer.querySelector(".bounding-boxes");
      if (layer) {
        layer.remove();
      }
    } else {
      clearBoundingBoxes(imageId);
    }
    return;
  }

  if (targetContainer) {
    drawBoundingBoxes(targetContainer, results, dimensionSource);
    return;
  }

  clearBoundingBoxes(imageId);

  const container = findImageContainer(imageId);
  if (!container) {
    return;
  }

  drawBoundingBoxes(container, results, dimensionSource);
}

export {
  boxToPercentages as convertBoxToPercentages,
  formatObjectScore,
  getLabelColor,
};
