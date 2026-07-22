import { RawImage } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.1";
import { requestCameraStream, showCameraFeedback } from "../utils/camera.js";
import { getObjectDetectorBackend } from "../models.js";
import {
  detectObjectsFromSource,
  renderBoundingBoxesOnContainer,
} from "../analysis/objects.js";
import { getSettings } from "./sidebar.js";

const ROLLING_WINDOW = 30;

function createLiveMetricsTracker() {
  const inferenceTimes = [];
  let frameCount = 0;

  return {
    recordInferenceMs(ms) {
      frameCount += 1;
      inferenceTimes.push(ms);
      if (inferenceTimes.length > ROLLING_WINDOW) {
        inferenceTimes.shift();
      }
    },
    getSnapshot() {
      const instantMs = inferenceTimes.at(-1) ?? null;
      const rollingAvgMs =
        inferenceTimes.length > 0
          ? inferenceTimes.reduce((sum, value) => sum + value, 0) /
            inferenceTimes.length
          : null;
      const effectiveFps =
        rollingAvgMs && rollingAvgMs > 0 ? 1000 / rollingAvgMs : null;

      return { instantMs, rollingAvgMs, effectiveFps, frameCount };
    },
  };
}

function formatMetricMs(value) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function formatMetricFps(value) {
  return value === null ? "—" : value.toFixed(2);
}

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
        <div class="live-metrics" aria-live="polite">
          <div class="live-metrics__backend" data-metric="backend">—</div>
          <dl class="live-metrics__list">
            <div class="live-metrics__row"><dt>Inference</dt><dd data-metric="instant">—</dd></div>
            <div class="live-metrics__row"><dt>Avg (30)</dt><dd data-metric="avg">—</dd></div>
            <div class="live-metrics__row"><dt>Effective FPS</dt><dd data-metric="fps">—</dd></div>
            <div class="live-metrics__row"><dt>Frames</dt><dd data-metric="frames">0</dd></div>
          </dl>
        </div>
      </div>
      <button type="button" class="camera-modal__cancel">Stop Live Detection</button>
    </div>
  `;

  const video = overlay.querySelector(".camera-modal__video");
  const mediaWrap = overlay.querySelector(".camera-modal__media");
  const stopButton = overlay.querySelector(".camera-modal__cancel");
  const card = overlay.querySelector(".camera-modal__card");
  const metricsPanel = overlay.querySelector(".live-metrics");
  const metrics = createLiveMetricsTracker();

  const frameCanvas = document.createElement("canvas");
  let frameW = 0;
  let frameH = 0;
  let running = true;
  let busy = false;
  let animationFrameId = null;

  function updateMetricsPanel() {
    const snapshot = metrics.getSnapshot();
    metricsPanel.querySelector('[data-metric="instant"]').textContent =
      formatMetricMs(snapshot.instantMs);
    metricsPanel.querySelector('[data-metric="avg"]').textContent =
      formatMetricMs(snapshot.rollingAvgMs);
    metricsPanel.querySelector('[data-metric="fps"]').textContent =
      formatMetricFps(snapshot.effectiveFps);
    metricsPanel.querySelector('[data-metric="frames"]').textContent =
      String(snapshot.frameCount);
  }

  getObjectDetectorBackend().then(({ device, dtype }) => {
    metricsPanel.querySelector('[data-metric="backend"]').textContent =
      `${device} · ${dtype}`;
  });

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
      const inferenceMs = t1 - t0;
      console.log(`[TIMING] live: ${inferenceMs.toFixed(0)}ms`);
      metrics.recordInferenceMs(inferenceMs);
      updateMetricsPanel();
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
