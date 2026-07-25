// Detection parameters for the live loop. The old analysis-settings UI is
// gone; these are fixed defaults until live-specific controls are added.
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
