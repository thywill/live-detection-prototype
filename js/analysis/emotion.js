import { loadModel, getModel } from "../models.js";

const NO_FACE_RESULT = {
  primaryEmotion: "No face detected",
  primaryScore: 0,
  allEmotions: [],
};

const FACE_CONFIDENCE_THRESHOLD = 0.25;

function roundScore(score) {
  return Math.round(score * 100) / 100;
}

function normalizeEmotionOutput(output) {
  if (!output) {
    return [];
  }

  const items = Array.isArray(output) ? output : [output];

  return items
    .map((item) => ({
      label: item.label,
      score: roundScore(item.score),
    }))
    .sort((a, b) => b.score - a.score);
}

function isNoFaceDetected(allEmotions) {
  if (!allEmotions.length) {
    return true;
  }

  return allEmotions[0].score < FACE_CONFIDENCE_THRESHOLD;
}

export async function detectEmotion(imageSrc) {
  try {
    await loadModel("emotionDetector");
    const model = getModel("emotionDetector");
    const output = await model(imageSrc);
    const allEmotions = normalizeEmotionOutput(output);

    if (isNoFaceDetected(allEmotions)) {
      return { ...NO_FACE_RESULT };
    }

    return {
      primaryEmotion: allEmotions[0].label,
      primaryScore: allEmotions[0].score,
      allEmotions,
    };
  } catch {
    return { ...NO_FACE_RESULT };
  }
}

export function renderEmotionResults(results) {
  if (
    results.primaryEmotion === "No face detected" ||
    !results.allEmotions?.length
  ) {
    return `<div class="emotion-results emotion-results--empty">
      <p class="emotion-results__message">No face detected in this image. Emotion analysis requires a visible face.</p>
    </div>`;
  }

  const emotionItems = results.allEmotions
    .map(
      (emotion) =>
        `<li class="emotion-result">
          <span class="emotion-result__label">${emotion.label}</span>
          <div class="emotion-result__bar-wrap">
            <div class="emotion-result__bar" style="width: ${emotion.score * 100}%"></div>
          </div>
          <span class="emotion-result__score">${emotion.score}</span>
        </li>`,
    )
    .join("");

  return `<div class="emotion-results">
    <p class="emotion-results__primary">${results.primaryEmotion}</p>
    <ul class="emotion-results__list">${emotionItems}</ul>
  </div>`;
}

export function shouldRunEmotion(objectDetectionResults) {
  if (!objectDetectionResults?.length) {
    return false;
  }

  return objectDetectionResults.some(
    (item) =>
      item.score > 0.5 && item.label.toLowerCase() === "person",
  );
}
