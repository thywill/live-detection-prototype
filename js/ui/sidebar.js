// Live-loop defaults (confidence / max objects). No settings UI yet; getSettings() is the seam for one later.
import { MODEL_OPTIONS, getModelId } from "../models.js";

const DEFAULT_PARAMETERS = {
  confidence: 0.5,
  maxObjects: 10,
};

export function getSettings() {
  return {
    analysisSettings: {},
    parameters: { ...DEFAULT_PARAMETERS },
  };
}

export function initModelPicker(onSelect) {
  const select = document.getElementById("model-picker");
  if (!select) {
    return null;
  }

  select.replaceChildren();
  for (const option of MODEL_OPTIONS) {
    const el = document.createElement("option");
    el.value = option.id;
    el.textContent = option.label;
    el.disabled = !option.enabled;
    select.appendChild(el);
  }
  select.value = getModelId();

  select.addEventListener("change", () => {
    const option = MODEL_OPTIONS.find((item) => item.id === select.value);
    if (!option?.enabled) {
      select.value = getModelId();
      return;
    }
    onSelect?.(select.value);
  });

  return select;
}
