// Whole-frame image classification via the classifier slot in models.js. No boxes.
import { loadModel, getModel } from "../models.js";

function normalizeScore(score) {
  const value = Number(score);
  return Number.isFinite(value) ? value : 0;
}

export async function classifyImageFromSource(source, { topK = 3 } = {}) {
  await loadModel("classifier");
  const model = getModel("classifier");
  const raw = await model(source, { topk: topK });
  const list = Array.isArray(raw) ? raw : [raw];

  return list
    .map((item) => ({
      label: item.label,
      score: normalizeScore(item.score),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}
