import { RawImage } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.1";
import { requestCameraStream, showCameraFeedback } from "../utils/camera.js";
import {
  getObjectDetectorBackend,
  loadModel,
  MODEL_ID,
  setLiveDetectionActive,
} from "../models.js";
import { createGpsTracker } from "../utils/geolocation.js";
import {
  clearLiveDetectionLog,
  getLiveDetectionLogCount,
  logDetectionFrame,
} from "../live/detection-log.js";
import {
  exportLiveDetectionCsv,
  exportLiveDetectionJson,
} from "../live/export-live.js";
import {
  detectObjectsFromSource,
  renderBoundingBoxesOnContainer,
} from "../analysis/objects.js";
import { getSettings } from "./sidebar.js";

const ROLLING_WINDOW = 30;
const MAX_INFERENCE_EDGE = 640;

function resolveInferenceIntervalMs() {
  // Space out inferences on touch devices so Safari can reclaim memory.
  // Desktop stays unthrottled (interval 0).
  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return coarsePointer ? 700 : 0;
}

const INFERENCE_INTERVAL_MS = resolveInferenceIntervalMs();

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

function formatGpsFix(fix) {
  if (!fix) {
    return "—";
  }
  const lat = fix.lat.toFixed(8);
  const lon = fix.lon.toFixed(8);
  const accuracy =
    fix.accuracy === null || fix.accuracy === undefined
      ? "—"
      : `±${Math.round(fix.accuracy)}m`;
  return `${lat}, ${lon} ${accuracy}`;
}

function computeInferenceSize(videoW, videoH) {
  const longest = Math.max(videoW, videoH);
  if (longest <= MAX_INFERENCE_EDGE) {
    return { width: videoW, height: videoH };
  }
  const scale = MAX_INFERENCE_EDGE / longest;
  return {
    width: Math.max(1, Math.round(videoW * scale)),
    height: Math.max(1, Math.round(videoH * scale)),
  };
}

function createPipelineInputHelper(ctx) {
  let rawImage = null;

  return function canvasToPipelineInput(canvas) {
    if (typeof RawImage !== "function") {
      return canvas.toDataURL("image/jpeg", 0.85);
    }

    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);

    if (
      rawImage &&
      rawImage.width === width &&
      rawImage.height === height &&
      rawImage.data?.length === imageData.data.length
    ) {
      rawImage.data.set(imageData.data);
      return rawImage;
    }

    // Recreate only when frame size changes (not every tick).
    rawImage = new RawImage(
      new Uint8ClampedArray(imageData.data),
      width,
      height,
      4,
    );
    return rawImage;
  };
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

  setLiveDetectionActive(true);
  try {
    await loadModel("objectDetector");
  } catch (error) {
    setLiveDetectionActive(false);
    showCameraFeedback("Object detector failed to load");
    console.error("[LIVE] detector preload failed:", error);
    for (const track of stream?.getTracks?.() ?? []) {
      track.stop();
    }
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
            <div class="live-metrics__row live-metrics__row--gps"><dt>GPS</dt><dd data-metric="gps">—</dd></div>
            <div class="live-metrics__row"><dt>Logged</dt><dd data-metric="logged">0</dd></div>
          </dl>
        </div>
      </div>
      <button type="button" class="camera-modal__record" aria-pressed="false">
        Start Recording
      </button>
      <div class="camera-modal__exports">
        <button type="button" class="camera-modal__export" data-export="csv">
          Export CSV
        </button>
        <button type="button" class="camera-modal__export" data-export="json">
          Export JSON
        </button>
      </div>
      <button type="button" class="camera-modal__cancel">Stop Live Detection</button>
    </div>
  `;

  const video = overlay.querySelector(".camera-modal__video");
  const mediaWrap = overlay.querySelector(".camera-modal__media");
  const stopButton = overlay.querySelector(".camera-modal__cancel");
  const recordButton = overlay.querySelector(".camera-modal__record");
  const exportCsvButton = overlay.querySelector('[data-export="csv"]');
  const exportJsonButton = overlay.querySelector('[data-export="json"]');
  const card = overlay.querySelector(".camera-modal__card");
  const metricsPanel = overlay.querySelector(".live-metrics");
  const metrics = createLiveMetricsTracker();
  const backendInfo = await getObjectDetectorBackend();
  const exportBackend = { ...backendInfo, model: MODEL_ID };
  let isRecording = false;
  let gpsFix = null;

  const frameCanvas = document.createElement("canvas");
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
  const canvasToPipelineInput = createPipelineInputHelper(frameCtx);
  let frameW = 0;
  let frameH = 0;
  let running = true;
  let busy = false;
  let animationFrameId = null;
  let lastCompletedInferenceAt = 0;

  console.log(`[LIVE] INFERENCE_INTERVAL_MS=${INFERENCE_INTERVAL_MS}`);

  clearLiveDetectionLog();

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
    metricsPanel.querySelector('[data-metric="gps"]').textContent =
      formatGpsFix(gpsFix);
    metricsPanel.querySelector('[data-metric="logged"]').textContent =
      String(getLiveDetectionLogCount());
  }

  metricsPanel.querySelector('[data-metric="backend"]').textContent =
    `${backendInfo.device} · ${backendInfo.dtype}`;

  const gps = createGpsTracker((fix) => {
    gpsFix = fix;
    updateMetricsPanel();
  });
  gps.start();

  function stopStream() {
    for (const track of stream?.getTracks?.() ?? []) {
      track.stop();
    }
  }

  function closeModal() {
    running = false;
    setLiveDetectionActive(false);
    gps.stop();
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

    if (
      INFERENCE_INTERVAL_MS > 0 &&
      performance.now() - lastCompletedInferenceAt < INFERENCE_INTERVAL_MS
    ) {
      return;
    }

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    if (!videoW || !videoH) {
      return;
    }

    const sized = computeInferenceSize(videoW, videoH);
    // Only resize when needed — setting canvas width/height every frame
    // reallocates the backing store and thrashs Safari memory.
    if (
      frameCanvas.width !== sized.width ||
      frameCanvas.height !== sized.height
    ) {
      frameCanvas.width = sized.width;
      frameCanvas.height = sized.height;
    }
    frameW = sized.width;
    frameH = sized.height;

    busy = true;
    frameCtx.drawImage(video, 0, 0, frameW, frameH);

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
      lastCompletedInferenceAt = performance.now();
      console.log(`[TIMING] live: ${inferenceMs.toFixed(0)}ms`);
      metrics.recordInferenceMs(inferenceMs);
      updateMetricsPanel();
      // Dimension source must match the downscaled inference canvas.
      renderBoundingBoxesOnContainer(mediaWrap, detections, frameCanvas);

      if (isRecording) {
        logDetectionFrame({
          detections,
          frameW,
          frameH,
          inferenceMs,
          timestamp: Date.now(),
          gpsFix: gps.getFix(),
          backend: backendInfo,
          modelId: MODEL_ID,
        });
        updateMetricsPanel();
      }
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

  recordButton.addEventListener("click", () => {
    isRecording = !isRecording;
    recordButton.textContent = isRecording ? "Stop Recording" : "Start Recording";
    recordButton.classList.toggle("camera-modal__record--active", isRecording);
    recordButton.setAttribute("aria-pressed", String(isRecording));
    if (isRecording) {
      updateMetricsPanel();
    }
  });

  function handleExport(exporter) {
    const ok = exporter(exportBackend);
    if (!ok) {
      showCameraFeedback("Nothing to export — start recording first");
    }
  }

  exportCsvButton.addEventListener("click", () => {
    handleExport(exportLiveDetectionCsv);
  });

  exportJsonButton.addEventListener("click", () => {
    handleExport(exportLiveDetectionJson);
  });

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
