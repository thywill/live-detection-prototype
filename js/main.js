// App entry: boots the live-detection page and preloads the object detector in the background.
import { loadModel } from "./models.js";
import { initLiveDetectionPage } from "./ui/live-detection.js";

document.addEventListener("DOMContentLoaded", () => {
  initLiveDetectionPage();

  loadModel("objectDetector").catch(() => {
    // Preload runs in background; errors surface when live detection starts.
  });
});
