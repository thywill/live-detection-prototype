import { loadModel } from "./models.js";
import { initLiveDetectionPage } from "./ui/live-detection.js";

document.addEventListener("DOMContentLoaded", () => {
  initLiveDetectionPage();

  loadModel("objectDetector").catch(() => {
    // Preload runs in background; errors surface when live detection starts.
  });
});
