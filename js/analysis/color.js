const QUANTIZE_STEP = 32;
const SAMPLE_STEP = 5;
const MAX_CANVAS_DIMENSION = 512;

function loadImage(imageSrc) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image for color analysis"));
    image.src = imageSrc;
  });
}

function quantizeChannel(value) {
  return Math.min(255, Math.round(value / QUANTIZE_STEP) * QUANTIZE_STEP);
}

function rgbToHex(r, g, b) {
  const toHex = (channel) => channel.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (max !== min) {
    const delta = max - min;
    saturation =
      lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    switch (max) {
      case red:
        hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
        break;
      case green:
        hue = ((blue - red) / delta + 2) / 6;
        break;
      default:
        hue = ((red - green) / delta + 4) / 6;
        break;
    }
  }

  return {
    h: hue * 360,
    s: saturation * 100,
    l: lightness * 100,
  };
}

function getHueName(hue) {
  if (hue < 15 || hue >= 345) {
    return "red";
  }
  if (hue < 40) {
    return "orange";
  }
  if (hue < 65) {
    return "yellow";
  }
  if (hue < 150) {
    return "green";
  }
  if (hue < 195) {
    return "cyan";
  }
  if (hue < 250) {
    return "blue";
  }
  if (hue < 295) {
    return "purple";
  }
  return "pink";
}

export function getColorName(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);

  if (s < 12) {
    if (l < 15) {
      return "black";
    }
    if (l > 88) {
      return "white";
    }
    if (l < 35) {
      return "dark grey";
    }
    if (l > 70) {
      return "light grey";
    }
    return "grey";
  }

  let modifier = "";

  if (l < 25) {
    modifier = "dark";
  } else if (l < 40) {
    modifier = "deep";
  } else if (l > 78) {
    modifier = "light";
  } else if (l > 65) {
    modifier = "pale";
  } else if (h < 40 && s > 45) {
    modifier = "warm";
  } else if (h > 180 && h < 260 && s > 40) {
    modifier = "cool";
  }

  const hueName = getHueName(h);
  return modifier ? `${modifier} ${hueName}` : hueName;
}

export async function extractColors(imageSrc, colorCount) {
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

  // EXPERIMENT
  const _tCol = performance.now();
  const { data } = context.getImageData(0, 0, width, height);
  const colorCounts = new Map();
  let sampledPixels = 0;

  for (let y = 0; y < height; y += SAMPLE_STEP) {
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];

      if (alpha < 128) {
        continue;
      }

      const r = quantizeChannel(data[index]);
      const g = quantizeChannel(data[index + 1]);
      const b = quantizeChannel(data[index + 2]);
      const key = `${r},${g},${b}`;

      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
      sampledPixels += 1;
    }
  }

  if (sampledPixels === 0) {
    console.log(
      `[TIMING] color: ${((performance.now() - _tCol) / 1000).toFixed(2)}s`,
    );
    return [];
  }

  const rankedColors = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, colorCount)
    .map(([key, count]) => {
      const [r, g, b] = key.split(",").map(Number);
      const percentage =
        Math.round((count / sampledPixels) * 1000) / 10;

      return {
        hex: rgbToHex(r, g, b),
        rgb: { r, g, b },
        percentage,
        name: getColorName(r, g, b),
      };
    });

  console.log(
    `[TIMING] color: ${((performance.now() - _tCol) / 1000).toFixed(2)}s`,
  );
  return rankedColors;
}

export function renderColorStrip(imageId, colors) {
  const strip = document.querySelector(
    `.gallery-card[data-id="${String(imageId)}"] .color-strip`,
  );

  if (!strip || !colors?.length) {
    return;
  }

  strip.replaceChildren();

  for (const color of colors) {
    const segment = document.createElement("div");
    segment.className = "color-strip__segment";
    segment.style.backgroundColor = color.hex;
    segment.style.flexGrow = color.percentage;
    segment.style.flexBasis = "0";
    segment.title = `${color.name} (${color.percentage}%)`;
    strip.appendChild(segment);
  }
}

export function renderColorResults(colors) {
  if (!colors?.length) {
    return "<p class=\"color-results__empty\">No colors detected.</p>";
  }

  const items = colors
    .map(
      (color) =>
        `<div class="color-result">
          <span class="color-result__swatch" style="background-color: ${color.hex}"></span>
          <span class="color-result__name">${color.name}</span>
          <span class="color-result__hex">${color.hex}</span>
          <span class="color-result__percentage">${color.percentage}%</span>
        </div>`,
    )
    .join("");

  return `<div class="color-results">${items}</div>`;
}
