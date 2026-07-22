const SAMPLE_STEP = 10;
const MAX_CANVAS_DIMENSION = 512;

const STANDARD_RATIOS = [
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
  { label: "3:4", value: 3 / 4 },
  { label: "2:3", value: 2 / 3 },
  { label: "9:16", value: 9 / 16 },
];

function loadImage(imageSrc) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Failed to load image for composition analysis"));
    image.src = imageSrc;
  });
}

function getPixelBrightness(data, index) {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
}

function getOrientation(width, height) {
  const ratio = width / height;

  if (ratio >= 0.95 && ratio <= 1.05) {
    return "square";
  }

  return width > height ? "landscape" : "portrait";
}

function getClosestAspectRatio(width, height) {
  const ratio = width / height;
  let closest = STANDARD_RATIOS[0];
  let smallestDiff = Infinity;

  for (const standardRatio of STANDARD_RATIOS) {
    const diff = Math.abs(ratio - standardRatio.value);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closest = standardRatio;
    }
  }

  return closest.label;
}

function getLightingType(brightnessScore, contrastScore) {
  if (brightnessScore > 65) {
    return "bright";
  }

  if (brightnessScore < 35) {
    return "dark";
  }

  if (contrastScore > 55) {
    return "high contrast";
  }

  if (contrastScore < 25) {
    return "low contrast";
  }

  return "balanced";
}

export async function analyzeComposition(imageSrc) {
  const image = await loadImage(imageSrc);
  const scale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / Math.max(image.width, image.height),
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  // EXPERIMENT
  const _tComp = performance.now();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const brightnessValues = [];
  const regionBrightness = {
    top: [],
    center: [],
    bottom: [],
  };
  let nearWhiteCount = 0;
  let sampledPixels = 0;

  const topEnd = Math.floor(height / 3);
  const centerEnd = Math.floor((height * 2) / 3);

  for (let y = 0; y < height; y += SAMPLE_STEP) {
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];

      if (alpha < 128) {
        continue;
      }

      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const brightness = getPixelBrightness(data, index);

      brightnessValues.push(brightness);
      sampledPixels += 1;

      if (red >= 240 && green >= 240 && blue >= 240) {
        nearWhiteCount += 1;
      }

      if (y < topEnd) {
        regionBrightness.top.push(brightness);
      } else if (y < centerEnd) {
        regionBrightness.center.push(brightness);
      } else {
        regionBrightness.bottom.push(brightness);
      }
    }
  }

  const averageBrightness =
    brightnessValues.length === 0
      ? 0
      : brightnessValues.reduce((sum, value) => sum + value, 0) /
        brightnessValues.length;

  const variance =
    brightnessValues.length === 0
      ? 0
      : brightnessValues.reduce(
          (sum, value) => sum + (value - averageBrightness) ** 2,
          0,
        ) / brightnessValues.length;

  const brightnessStdDev = Math.sqrt(variance);
  const brightnessScore = Math.round(averageBrightness * 100);
  const contrastScore = Math.min(100, Math.round(brightnessStdDev * 250));
  const negativeSpaceEstimate =
    sampledPixels === 0
      ? 0
      : Math.round((nearWhiteCount / sampledPixels) * 1000) / 10;

  const regionAverages = Object.entries(regionBrightness).map(
    ([region, values]) => ({
      region,
      average:
        values.length === 0
          ? 0
          : values.reduce((sum, value) => sum + value, 0) / values.length,
    }),
  );

  const dominantRegion = regionAverages.reduce((brightest, current) =>
    current.average > brightest.average ? current : brightest,
  ).region;

  console.log(
    `[TIMING] composition: ${((performance.now() - _tComp) / 1000).toFixed(2)}s`,
  );
  return {
    orientation: getOrientation(image.width, image.height),
    aspectRatio: getClosestAspectRatio(image.width, image.height),
    brightnessScore,
    contrastScore,
    lightingType: getLightingType(brightnessScore, contrastScore),
    dominantRegion,
    negativeSpaceEstimate,
  };
}

export function renderCompositionResults(composition) {
  const metrics = [
    { label: "Orientation", value: composition.orientation },
    { label: "Aspect ratio", value: composition.aspectRatio },
    { label: "Brightness", value: `${composition.brightnessScore}` },
    { label: "Contrast", value: `${composition.contrastScore}` },
    { label: "Lighting", value: composition.lightingType },
    { label: "Dominant region", value: composition.dominantRegion },
    {
      label: "Negative space",
      value: `${composition.negativeSpaceEstimate}%`,
    },
  ];

  const cards = metrics
    .map(
      (metric) =>
        `<div class="composition-metric">
          <span class="composition-metric__label">${metric.label}</span>
          <span class="composition-metric__value">${metric.value}</span>
        </div>`,
    )
    .join("");

  return `<div class="composition-results">${cards}</div>`;
}
