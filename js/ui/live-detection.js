import { RawImage } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.1";
import { requestCameraStream, showCameraFeedback } from "../utils/camera.js";
import {
  detectObjectsFromSource,
  renderBoundingBoxesOnContainer,
} from "../analysis/objects.js";
import { getSettings } from "./sidebar.js";

function canvasToPipelineInput(canvas) {
  if (typeof RawImage?.fromCanvas === "function") {
    return RawImage.fromCanvas(canvas);
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}

export async function openLiveDetectionModal() {
  let stream;

  try {
    stream = await requestCameraStream();
  } catch {
    showCameraFeedback(
      "Camera access was denied — please use Upload Images instead",
    );
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "camera-modal camera-modal--live";
  overlay.innerHTML = `
    <div class="camera-modal__card" role="dialog" aria-modal="true" aria-label="Live object detection">
      <div class="camera-modal__media">
        <video class="camera-modal__video" autoplay playsinline muted></video>
      </div>
      <button type="button" class="camera-modal__cancel">Stop Live Detection</button>
    </div>
  `;

  const video = overlay.querySelector(".camera-modal__video");
  const mediaWrap = overlay.querySelector(".camera-modal__media");
  const stopButton = overlay.querySelector(".camera-modal__cancel");
  const card = overlay.querySelector(".camera-modal__card");

  const frameCanvas = document.createElement("canvas");
  let frameW = 0;
  let frameH = 0;
  let running = true;
  let busy = false;
  let animationFrameId = null;

  function stopStream() {
    for (const track of stream?.getTracks?.() ?? []) {
      track.stop();
    }
  }

  function closeModal() {
    running = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
    stopStream();
    overlay.remove();
  }

  async function tick() {
    if (!running || busy) {
      return;
    }

    frameW = video.videoWidth;
    frameH = video.videoHeight;
    if (!frameW || !frameH) {
      return;
    }

    busy = true;

    frameCanvas.width = frameW;
    frameCanvas.height = frameH;
    frameCanvas.getContext("2d").drawImage(video, 0, 0, frameW, frameH);

    const { parameters } = getSettings();
    const t0 = performance.now();

    try {
      const pipelineInput = canvasToPipelineInput(frameCanvas);
      const detections = await detectObjectsFromSource(pipelineInput, {
        threshold: parameters.confidence,
        maxObjects: parameters.maxObjects,
      });
      const t1 = performance.now();
      console.log(`[TIMING] live: ${(t1 - t0).toFixed(0)}ms`);
      renderBoundingBoxesOnContainer(mediaWrap, detections, video);
    } catch (error) {
      console.error("[LIVE] detection failed:", error);
    } finally {
      busy = false;
    }
  }

  function loop() {
    if (!running) {
      return;
    }

    tick();
    animationFrameId = requestAnimationFrame(loop);
  }

  stopButton.addEventListener("click", closeModal);

  overlay.addEventListener("click", (event) => {
    if (!card.contains(event.target)) {
      closeModal();
    }
  });

  document.body.appendChild(overlay);
  video.srcObject = stream;
  await video.play().catch(() => {});
  loop();
}
