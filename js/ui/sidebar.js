// Live-loop defaults (confidence / max objects). No settings UI yet; getSettings() is the seam for one later.
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
