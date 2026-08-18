// Live page: camera loop, stats, recording toggle, and export buttons.
// Detection goes through objects.js / models.js; GPS and the log live in geolocation.js and detection-log.js.
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
// Cap the longest edge at 640px so full-resolution camera frames don't exhaust memory on mobile Safari.
const MAX_INFERENCE_EDGE = 640;

// Coarse-pointer devices (iPad etc.) wait ~700ms between completed inferences so memory can release; desktop stays 0.
function resolveInferenceIntervalMs() {
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
    reset() {
      inferenceTimes.length = 0;
      frameCount = 0;
    },
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
  const accuracy =
    fix.accuracy === null || fix.accuracy === undefined
      ? "—"
      : `±${Math.round(fix.accuracy)}m`;
  return `${fix.lat.toFixed(8)}, ${fix.lon.toFixed(8)}\n${accuracy}`;
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

  // Transformers.js rejects a raw <canvas>; reuse one RawImage (JPEG data URL if RawImage is unavailable) to avoid per-frame allocations.
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

    rawImage = new RawImage(
      new Uint8ClampedArray(imageData.data),
      width,
      height,
      4,
    );
    return rawImage;
  };
}

export function initLiveDetectionPage() {
  const video = document.getElementById("live-video");
  const feed = document.getElementById("live-feed");
  const idle = document.getElementById("live-idle");
  const mediaWrap = document.querySelector(".live-stage__media");
  const liveToggle = document.getElementById("btn-live-toggle");
  const mainStart = document.getElementById("btn-live-start-main");
  const recordButton = document.getElementById("btn-record");
  const exportCsvButton = document.getElementById("btn-export-csv");
  const exportJsonButton = document.getElementById("btn-export-json");

  if (
    !video ||
    !feed ||
    !idle ||
    !mediaWrap ||
    !liveToggle ||
    !mainStart ||
    !recordButton ||
    !exportCsvButton ||
    !exportJsonButton
  ) {
    return;
  }

  const metrics = createLiveMetricsTracker();
  const frameCanvas = document.createElement("canvas");
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
  const canvasToPipelineInput = createPipelineInputHelper(frameCtx);

  let stream = null;
  let gps = null;
  let gpsFix = null;
  let backendInfo = null;
  let running = false;
  let busy = false;
  let isRecording = false;
  let animationFrameId = null;
  let lastCompletedInferenceAt = 0;
  let frameW = 0;
  let frameH = 0;

  function setMetric(name, value) {
    const target = document.querySelector(`[data-metric="${name}"]`);
    if (target) {
      target.textContent = value;
    }
  }

  function updateMetricsPanel() {
    const snapshot = metrics.getSnapshot();
    setMetric("instant", formatMetricMs(snapshot.instantMs));
    setMetric("avg", formatMetricMs(snapshot.rollingAvgMs));
    setMetric("fps", formatMetricFps(snapshot.effectiveFps));
    setMetric("frames", String(snapshot.frameCount));
    setMetric("gps", formatGpsFix(gpsFix));
    setMetric("logged", String(getLiveDetectionLogCount()));
  }

  function updateControls() {
    liveToggle.textContent = running
      ? "Stop Live Detection"
      : "Start Live Detection";
    liveToggle.setAttribute("aria-pressed", String(running));
    recordButton.disabled = !running;
    recordButton.textContent = isRecording
      ? "Stop Recording"
      : "Start Recording";
    recordButton.setAttribute("aria-pressed", String(isRecording));
    recordButton.classList.toggle("btn--record-active", isRecording);
    feed.hidden = !running;
    idle.hidden = running;
  }

  function stopStream() {
    for (const track of stream?.getTracks?.() ?? []) {
      track.stop();
    }
    stream = null;
    video.srcObject = null;
  }

  function stopLiveDetection() {
    running = false;
    busy = false;
    isRecording = false;
    setLiveDetectionActive(false);
    gps?.stop();
    gps = null;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    stopStream();
    mediaWrap.querySelector(".bounding-boxes")?.remove();
    updateControls();
  }

  async function tick() {
    // Single-in-flight: never start a new inference while one is running, so frames cannot pile up.
    if (!running || busy) {
      return;
    }
    // Throttle from last *completed* inference, not last tick, so a slow frame still gets breathing room.
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
      const detections = await detectObjectsFromSource(
        canvasToPipelineInput(frameCanvas),
        {
          threshold: parameters.confidence,
          maxObjects: parameters.maxObjects,
        },
      );
      const inferenceMs = performance.now() - t0;
      lastCompletedInferenceAt = performance.now();
      console.log(`[TIMING] live: ${inferenceMs.toFixed(0)}ms`);
      metrics.recordInferenceMs(inferenceMs);
      renderBoundingBoxesOnContainer(mediaWrap, detections, frameCanvas);

      if (isRecording) {
        logDetectionFrame({
          detections,
          frameW,
          frameH,
          inferenceMs,
          timestamp: Date.now(),
          gpsFix: gps?.getFix() ?? null,
          backend: backendInfo,
          modelId: MODEL_ID,
        });
      }
      updateMetricsPanel();
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

  async function startLiveDetection() {
    if (running) {
      return;
    }

    liveToggle.disabled = true;
    mainStart.disabled = true;
    try {
      stream = await requestCameraStream();
      setLiveDetectionActive(true);
      await loadModel("objectDetector");
      backendInfo = await getObjectDetectorBackend();
      setMetric("backend", `${backendInfo.device} · ${backendInfo.dtype}`);

      clearLiveDetectionLog();
      metrics.reset();
      gpsFix = null;
      lastCompletedInferenceAt = 0;
      updateMetricsPanel();

      gps = createGpsTracker((fix) => {
        gpsFix = fix;
        updateMetricsPanel();
      });
      gps.start();

      video.srcObject = stream;
      await video.play();
      running = true;
      updateControls();
      console.log(`[LIVE] INFERENCE_INTERVAL_MS=${INFERENCE_INTERVAL_MS}`);
      loop();
    } catch (error) {
      setLiveDetectionActive(false);
      stopStream();
      showCameraFeedback("Live detection could not start");
      console.error("[LIVE] start failed:", error);
    } finally {
      liveToggle.disabled = false;
      mainStart.disabled = false;
    }
  }

  function handleExport(exporter) {
    const exportBackend = { ...(backendInfo ?? {}), model: MODEL_ID };
    if (!exporter(exportBackend)) {
      showCameraFeedback("Nothing to export — start recording first");
    }
  }

  liveToggle.addEventListener("click", () => {
    if (running) {
      stopLiveDetection();
    } else {
      startLiveDetection();
    }
  });
  mainStart.addEventListener("click", startLiveDetection);
  recordButton.addEventListener("click", () => {
    if (!running) {
      return;
    }
    isRecording = !isRecording;
    updateControls();
  });
  exportCsvButton.addEventListener("click", () =>
    handleExport(exportLiveDetectionCsv),
  );
  exportJsonButton.addEventListener("click", () =>
    handleExport(exportLiveDetectionJson),
  );
  window.addEventListener("pagehide", stopLiveDetection);

  updateControls();
  updateMetricsPanel();
}
