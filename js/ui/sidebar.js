const TOGGLE_MAP = {
  "toggle-objects": "objects",
  "toggle-color": "color",
  "toggle-caption": "caption",
  "toggle-composition": "composition",
  "toggle-emotion": "emotion",
  "toggle-photo-style": "photoStyle",
};

const SLIDER_MAP = {
  "param-confidence": "confidence",
  "param-max-objects": "maxObjects",
  "param-colors-extract": "colorsToExtract",
};

const DEFAULT_ANALYSIS_SETTINGS = {
  objects: true,
  color: true,
  caption: true,
  composition: true,
  emotion: false,
  photoStyle: false,
};

const DEFAULT_PARAMETERS = {
  confidence: 0.5,
  maxObjects: 10,
  colorsToExtract: 5,
};

const DEFAULT_SLIDER_VALUES = {
  "param-confidence": "0.5",
  "param-max-objects": "10",
  "param-colors-extract": "5",
};

export const analysisSettings = { ...DEFAULT_ANALYSIS_SETTINGS };
export const parameters = { ...DEFAULT_PARAMETERS };

function updateToggleVisual(toggleInput) {
  const label = toggleInput.closest(".toggle");
  if (label) {
    label.classList.toggle("toggle--active", toggleInput.checked);
  }
}

function syncToggleSetting(toggleId) {
  const toggle = document.getElementById(toggleId);
  const settingKey = TOGGLE_MAP[toggleId];

  if (!toggle || !settingKey) {
    return;
  }

  analysisSettings[settingKey] = toggle.checked;
  updateToggleVisual(toggle);
}

function syncSliderSetting(sliderId) {
  const slider = document.getElementById(sliderId);
  const output = document.getElementById(`${sliderId}-value`);
  const parameterKey = SLIDER_MAP[sliderId];

  if (!slider || !parameterKey) {
    return;
  }

  const value =
    parameterKey === "confidence"
      ? parseFloat(slider.value)
      : parseInt(slider.value, 10);

  parameters[parameterKey] = value;

  if (output) {
    output.textContent = slider.value;
  }
}

function resetDefaults() {
  for (const [toggleId, settingKey] of Object.entries(TOGGLE_MAP)) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) {
      continue;
    }

    toggle.checked = DEFAULT_ANALYSIS_SETTINGS[settingKey];
    analysisSettings[settingKey] = DEFAULT_ANALYSIS_SETTINGS[settingKey];
    updateToggleVisual(toggle);
  }

  for (const [sliderId, parameterKey] of Object.entries(SLIDER_MAP)) {
    const slider = document.getElementById(sliderId);
    if (!slider) {
      continue;
    }

    slider.value = DEFAULT_SLIDER_VALUES[sliderId];
    parameters[parameterKey] = DEFAULT_PARAMETERS[parameterKey];
    syncSliderSetting(sliderId);
  }
}

export function getSettings() {
  return { analysisSettings, parameters };
}

function dispatchSettingsChanged(changed) {
  window.dispatchEvent(
    new CustomEvent("settings-changed", {
      detail: {
        analysisSettings: { ...analysisSettings },
        parameters: { ...parameters },
        changed,
      },
    }),
  );
}

export function initSidebar() {
  for (const toggleId of Object.keys(TOGGLE_MAP)) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) {
      continue;
    }

    syncToggleSetting(toggleId);
    toggle.addEventListener("change", () => {
      syncToggleSetting(toggleId);
      dispatchSettingsChanged({
        toggles: [TOGGLE_MAP[toggleId]],
        parameters: [],
      });
    });
  }

  for (const sliderId of Object.keys(SLIDER_MAP)) {
    const slider = document.getElementById(sliderId);
    if (!slider) {
      continue;
    }

    syncSliderSetting(sliderId);
    slider.addEventListener("input", () => {
      syncSliderSetting(sliderId);
      dispatchSettingsChanged({
        toggles: [],
        parameters: [SLIDER_MAP[sliderId]],
      });
    });
  }

  const resetButton = document.getElementById("btn-reset-defaults");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      resetDefaults();
      dispatchSettingsChanged({
        toggles: Object.values(TOGGLE_MAP),
        parameters: Object.values(SLIDER_MAP),
      });
    });
  }
}
