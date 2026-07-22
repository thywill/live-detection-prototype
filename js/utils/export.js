export const analysisStore = {};

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(filename) {
  const sanitized = String(filename)
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  return sanitized || "image";
}

function getResultForImage(image, analysisResults) {
  if (!analysisResults) {
    return {};
  }

  if (analysisResults[image.id] !== undefined) {
    return analysisResults[image.id];
  }

  if (analysisResults[String(image.id)] !== undefined) {
    return analysisResults[String(image.id)];
  }

  return {};
}

function formatObjectLabels(objects) {
  return objects?.map((object) => object.label).join(", ") ?? "";
}

function formatObjectScores(objects) {
  return objects?.map((object) => object.score).join(", ") ?? "";
}

function buildCsvRow(image, results) {
  const colors = results.colors ?? [];
  const composition = results.composition ?? {};
  const emotion = results.emotion ?? {};

  const emotionLabel =
    emotion.primaryEmotion && emotion.primaryEmotion !== "No face detected"
      ? emotion.primaryEmotion
      : "";
  const emotionScore =
    emotionLabel && typeof emotion.primaryScore === "number"
      ? emotion.primaryScore
      : "";

  return [
    image.name,
    results.caption ?? "",
    colors[0]?.hex ?? "",
    colors[0]?.percentage ?? "",
    colors[1]?.hex ?? "",
    colors[1]?.percentage ?? "",
    colors[2]?.hex ?? "",
    colors[2]?.percentage ?? "",
    formatObjectLabels(results.objects),
    formatObjectScores(results.objects),
    composition.orientation ?? "",
    composition.aspectRatio ?? "",
    composition.brightnessScore ?? "",
    composition.contrastScore ?? "",
    composition.lightingType ?? "",
    composition.negativeSpaceEstimate ?? "",
    emotionLabel,
    emotionScore,
  ].map(escapeCsvValue).join(",");
}

export function storeAnalysisResult(imageId, results) {
  analysisStore[String(imageId)] = {
    ...results,
    analyzedAt: results.analyzedAt ?? new Date().toISOString(),
  };
}

export function getAnalysisResult(imageId) {
  return analysisStore[String(imageId)] ?? null;
}

export async function exportToCSV(images, analysisResults) {
  const headers = [
    "filename",
    "caption",
    "dominant color 1 hex",
    "dominant color 1 percentage",
    "dominant color 2 hex",
    "dominant color 2 percentage",
    "dominant color 3 hex",
    "dominant color 3 percentage",
    "objects found",
    "object scores",
    "orientation",
    "aspect ratio",
    "brightness",
    "contrast",
    "lighting type",
    "negative space",
    "emotion",
    "emotion score",
  ];

  const rows = images.map((image) => {
    const results = getResultForImage(image, analysisResults);
    return buildCsvRow(image, results);
  });

  const csv = [headers.join(","), ...rows].join("\n");
  downloadFile(csv, "visual-analysis-export.csv", "text/csv;charset=utf-8");
}

function formatColorsSection(colors) {
  if (!colors?.length) {
    return "No dominant colors detected.";
  }

  return colors
    .map(
      (color, index) =>
        `${index + 1}. ${color.hex} (${color.name}) — ${color.percentage}%`,
    )
    .join("\n");
}

function formatObjectsSection(objects) {
  if (!objects?.length) {
    return "No objects detected.";
  }

  return objects
    .map((object) => `- ${object.label} (${object.score})`)
    .join("\n");
}

function formatCompositionSection(composition) {
  if (!composition) {
    return "Composition analysis unavailable.";
  }

  return [
    `Orientation: ${composition.orientation ?? "—"}`,
    `Aspect ratio: ${composition.aspectRatio ?? "—"}`,
    `Brightness: ${composition.brightnessScore ?? "—"}`,
    `Contrast: ${composition.contrastScore ?? "—"}`,
    `Lighting: ${composition.lightingType ?? "—"}`,
    `Dominant region: ${composition.dominantRegion ?? "—"}`,
    `Negative space: ${composition.negativeSpaceEstimate ?? "—"}%`,
  ].join("\n");
}

function formatEmotionSection(emotion) {
  if (!emotion) {
    return "Emotion analysis unavailable.";
  }

  if (
    emotion.primaryEmotion === "No face detected" ||
    !emotion.allEmotions?.length
  ) {
    return "No face detected.";
  }

  const lines = [
    `Primary emotion: ${emotion.primaryEmotion} (${emotion.primaryScore})`,
  ];

  if (emotion.allEmotions?.length) {
    lines.push(
      "",
      "All emotions:",
      ...emotion.allEmotions.map(
        (entry) => `- ${entry.label}: ${entry.score}`,
      ),
    );
  }

  return lines.join("\n");
}

export function exportSingleImageReport(image, analysisResult) {
  const results = analysisResult ?? {};
  const analyzedAt = results.analyzedAt
    ? new Date(results.analyzedAt).toLocaleString()
    : new Date().toLocaleString();

  const report = [
    "Visual Analysis Report",
    "====================",
    "",
    `Filename: ${image.name}`,
    `Date analyzed: ${analyzedAt}`,
    "",
    "Caption",
    "-------",
    results.caption ?? "Caption unavailable.",
    "",
    "Dominant Colors",
    "---------------",
    formatColorsSection(results.colors),
    "",
    "Objects",
    "-------",
    formatObjectsSection(results.objects),
    "",
    "Composition",
    "-----------",
    formatCompositionSection(results.composition),
    "",
    "Emotion",
    "-------",
    formatEmotionSection(results.emotion),
    "",
  ].join("\n");

  const filename = `${sanitizeFilename(image.name)}-analysis.txt`;
  downloadFile(report, filename, "text/plain;charset=utf-8");
}
