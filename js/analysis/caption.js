import { loadModel, getModel } from "../models.js";

const FALLBACK_CAPTION = "Caption unavailable";

function capitalizeFirstLetter(text) {
  if (!text) {
    return text;
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cleanCaption(text) {
  return capitalizeFirstLetter(text.trim());
}

function extractGeneratedText(output) {
  if (!output) {
    return "";
  }

  if (typeof output === "string") {
    return output;
  }

  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string") {
      return first;
    }
    if (first?.generated_text) {
      return first.generated_text;
    }
  }

  if (output.generated_text) {
    return output.generated_text;
  }

  return "";
}

function isMobileDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export async function generateCaption(imageSrc) {
  const preview =
    typeof imageSrc === "string" ? imageSrc.substring(0, 50) : String(imageSrc);
  console.log("Caption input type:", typeof imageSrc, preview);

  try {
    await loadModel("captioner");
    const model = getModel("captioner");
    // EXPERIMENT
    const _tCap = performance.now();
    const inferencePromise = model(imageSrc, { max_new_tokens: 50 });
    let output;

    if (isMobileDevice()) {
      let timeoutId = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          reject(new Error("Caption timeout"));
        }, 30000);
      });
      try {
        output = await Promise.race([inferencePromise, timeoutPromise]);
      } finally {
        if (timeoutId) {
          globalThis.clearTimeout(timeoutId);
        }
      }
    } else {
      output = await inferencePromise;
    }
    console.log(
      `[TIMING] caption: ${((performance.now() - _tCap) / 1000).toFixed(2)}s`,
    );

    console.log("Caption raw output:", JSON.stringify(output));
    const captionText = cleanCaption(extractGeneratedText(output));
    console.log(`[TIMING] caption text: "${captionText}"`);

    return captionText || FALLBACK_CAPTION;
  } catch (err) {
    console.log("Caption error:", err?.message, err?.stack);
    return FALLBACK_CAPTION;
  }
}

export function updateGalleryCaption(imageId, caption) {
  const captionEl = document.querySelector(
    `.gallery-card[data-id="${String(imageId)}"] .gallery-card__caption`,
  );

  if (captionEl) {
    captionEl.textContent = caption;
  }
}

export function renderCaptionResult(caption) {
  const safeCaption = caption?.trim() || FALLBACK_CAPTION;

  return `<blockquote class="caption-result">${safeCaption}</blockquote>`;
}
