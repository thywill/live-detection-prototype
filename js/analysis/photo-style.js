import { loadModel, getModel } from "../models.js";

const SAMPLE_STEP = 10;
const MAX_CANVAS_DIMENSION = 512;

const BACKGROUND_KEYWORDS = {
  studio: ["stage", "spotlight", "wall", "grey", "plain", "curtain"],
  outdoor: ["sky", "field", "beach", "mountain", "tree", "garden"],
  urban: ["street", "city", "building", "traffic", "downtown"],
  indoor: ["room", "office", "home", "kitchen", "hall"],
  nature: ["forest", "lake", "river", "coast"],
};

const STYLE_LIGHTING_LABELS = {
  bright: "bright",
  dark: "dramatic",
  "high contrast": "high contrast",
  "soft/flat": "soft",
  balanced: "natural",
};

function loadImage(imageSrc) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Failed to load image for photo style analysis"));
    image.src = imageSrc;
  });
}

function getPixelBrightness255(red, green, blue) {
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function getPixelSaturation(red, green, blue) {
  const max = Math.max(red, green, blue) / 255;
  const min = Math.min(red, green, blue) / 255;

  if (max === 0) {
    return 0;
  }

  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  return lightness > 0.5
    ? (delta / (2 - max - min)) * 100
    : (delta / (max + min)) * 100;
}

function mapLabelsToBackground(predictions) {
  const scores = {
    studio: 0,
    outdoor: 0,
    urban: 0,
    indoor: 0,
    nature: 0,
  };

  for (const prediction of predictions) {
    const labelLower = prediction.label.toLowerCase();

    for (const [background, keywords] of Object.entries(BACKGROUND_KEYWORDS)) {
      if (keywords.some((keyword) => labelLower.includes(keyword))) {
        scores[background] += prediction.score;
      }
    }
  }

  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  return ranked[0]?.[0] ?? "unclassified";
}

function classifyLighting(meanBrightness, stdDev) {
  if (meanBrightness > 180) {
    return "bright";
  }

  if (meanBrightness < 60) {
    return "dark";
  }

  if (stdDev > 70) {
    return "high contrast";
  }

  if (stdDev < 30) {
    return "soft/flat";
  }

  return "balanced";
}

function classifyColorTreatment(averageSaturation) {
  if (averageSaturation < 15) {
    return "black & white";
  }

  if (averageSaturation < 40) {
    return "desaturated";
  }

  if (averageSaturation < 70) {
    return "muted";
  }

  return "colour";
}

function formatBackgroundLabel(background) {
  if (background === "unclassified") {
    return "Unclassified";
  }

  return background.charAt(0).toUpperCase() + background.slice(1);
}

function buildStyleLabel(background, lighting) {
  const backgroundLabel = formatBackgroundLabel(background);
  const lightingLabel = STYLE_LIGHTING_LABELS[lighting] ?? lighting;
  return `${backgroundLabel} · ${lightingLabel}`;
}

async function analyzeCanvasMetrics(imageSrc) {
  const image = await loadImage(imageSrc);
  const scale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / Math.max(image.width, image.height),
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const brightnessValues = [];
  const saturationValues = [];

  for (let y = 0; y < height; y += SAMPLE_STEP) {
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];

      brightnessValues.push(getPixelBrightness255(red, green, blue));
      saturationValues.push(getPixelSaturation(red, green, blue));
    }
  }

  const meanBrightness =
    brightnessValues.length === 0
      ? 0
      : brightnessValues.reduce((sum, value) => sum + value, 0) /
        brightnessValues.length;

  const variance =
    brightnessValues.length === 0
      ? 0
      : brightnessValues.reduce(
          (sum, value) => sum + (value - meanBrightness) ** 2,
          0,
        ) / brightnessValues.length;

  const stdDev = Math.sqrt(variance);

  const averageSaturation =
    saturationValues.length === 0
      ? 0
      : saturationValues.reduce((sum, value) => sum + value, 0) /
        saturationValues.length;

  const lighting = classifyLighting(meanBrightness, stdDev);
  const colorTreatment = classifyColorTreatment(averageSaturation);

  return { lighting, colorTreatment };
}

async function classifyScene(imageSrc) {
  await loadModel("sceneClassifier");
  const model = getModel("sceneClassifier");
  const output = await model(imageSrc);

  const predictions = Array.isArray(output) ? output : [output];
  const background = mapLabelsToBackground(predictions);

  return background;
}

export async function analyzePhotoStyle(imageSrc) {
  const [canvasMetrics, background] = await Promise.all([
    analyzeCanvasMetrics(imageSrc),
    classifyScene(imageSrc),
  ]);

  const { lighting, colorTreatment } = canvasMetrics;
  const style = buildStyleLabel(background, lighting);

  return {
    background,
    lighting,
    colorTreatment,
    style,
  };
}

export function renderPhotoStyleResults(styleObj) {
  if (!styleObj) {
    return "<p class=\"photo-style-results__empty\">Photo style unavailable.</p>";
  }

  const metrics = [
    { label: "Style", value: styleObj.style },
    { label: "Background", value: formatBackgroundLabel(styleObj.background) },
    { label: "Lighting", value: styleObj.lighting },
    { label: "Colour treatment", value: styleObj.colorTreatment },
  ];

  const rows = metrics
    .map(
      (metric) =>
        `<div class="photo-style-metric">
          <span class="photo-style-metric__label">${metric.label}</span>
          <span class="photo-style-metric__value">${metric.value}</span>
        </div>`,
    )
    .join("");

  return `<div class="photo-style-results">${rows}</div>`;
}
