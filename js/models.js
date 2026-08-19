// Loads Transformers.js pipelines (object-detection or image-classification) and chooses WebGPU or WASM.
// live-detection.js reads the resolved device/dtype via getObjectDetectorBackend().
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.1";

export const MODEL_OPTIONS = [
  { id: "Xenova/yolos-tiny", label: "YOLOS-tiny (detection)", task: "detection", enabled: true },
  { id: "Xenova/detr-resnet-50", label: "DETR (detection)", task: "detection", enabled: true },
  { id: "Xenova/mobilenet_v2_1.0_224", label: "MobileNet (classification)", task: "classification", enabled: true },
  { id: "llm:scene-description", label: "LLM — scene description (coming soon)", task: "llm", enabled: false },
];

let MODEL_ID = "Xenova/yolos-tiny";
const DTYPE = "auto";

export function getModelId() {
  return MODEL_ID;
}

export function getModelTask() {
  return MODEL_OPTIONS.find((item) => item.id === MODEL_ID)?.task ?? "detection";
}

export function getActiveSlot() {
  return getModelTask() === "classification" ? "classifier" : "objectDetector";
}

let liveDetectionActive = false;

export function setLiveDetectionActive(active) {
  liveDetectionActive = Boolean(active);
}

const DEFAULT_DTYPE_BY_DEVICE = {
  webgpu: "fp16",
  wasm: "q8",
};

// Use WebGPU whenever requestAdapter() returns an adapter; WASM only if GPU is missing, null, or throws.
async function pickDevice() {
  if (!navigator.gpu) {
    console.log("[BACKEND] navigator.gpu missing → wasm");
    return "wasm";
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) {
      const info =
        typeof adapter.requestAdapterInfo === "function"
          ? await adapter.requestAdapterInfo().catch(() => null)
          : null;
      console.log("[BACKEND] WebGPU adapter available → webgpu", info ?? "");
      return "webgpu";
    }

    console.log(
      "[BACKEND] requestAdapter() returned null → wasm (no adapter)",
    );
    return "wasm";
  } catch (error) {
    console.log(
      "[BACKEND] requestAdapter() threw → wasm",
      error?.message ?? error,
    );
    return "wasm";
  }
}

const resolvedDevicePromise = pickDevice();

// fp16 is typically faster on WebGPU; q8 is the WASM default. Set DTYPE (not "auto") to force a precision for comparison.
function resolveDtypeForDevice(device) {
  if (DTYPE !== "auto") {
    return DTYPE;
  }
  return DEFAULT_DTYPE_BY_DEVICE[device] ?? "q8";
}

export async function getObjectDetectorBackend() {
  const device = await resolvedDevicePromise;
  return {
    device,
    dtype: resolveDtypeForDevice(device),
  };
}

const MODEL_CONFIG = {
  objectDetector: {
    task: "object-detection",
    get model() {
      return MODEL_ID;
    },
  },
  classifier: {
    task: "image-classification",
    get model() {
      return MODEL_ID;
    },
  },
};

const models = {
  objectDetector: null,
  classifier: null,
};

export const modelStatus = {
  objectDetector: "idle",
  classifier: "idle",
};

const loadingPromises = {};

function dispatchModelStatusChange(modelName, status) {
  window.dispatchEvent(
    new CustomEvent("model-status-change", {
      detail: { modelName, status },
    }),
  );
}

function setModelStatus(modelName, status) {
  modelStatus[modelName] = status;
  dispatchModelStatusChange(modelName, status);
}

export function isModelReady(modelName) {
  return modelStatus[modelName] === "ready";
}

export function getModel(modelName) {
  return models[modelName];
}

export async function loadModel(modelName) {
  if (isModelReady(modelName)) {
    return models[modelName];
  }

  if (loadingPromises[modelName]) {
    return loadingPromises[modelName];
  }

  const config = MODEL_CONFIG[modelName];
  if (!config) {
    throw new Error(`Unknown model: ${modelName}`);
  }

  const requestedModel = config.model;

  setModelStatus(modelName, "loading");

  const _tStart = performance.now();
  console.log(`[TIMING] ${modelName}: loading started (${requestedModel})`);

  const device = await resolvedDevicePromise;
  const dtype = resolveDtypeForDevice(device);
  console.log(`[BACKEND] device=${device} dtype=${dtype}`);

  const loadPromise = pipeline(config.task, requestedModel, {
    device,
    dtype,
  })
    .then((instance) => {
      if (config.model !== requestedModel) {
        return models[modelName];
      }
      models[modelName] = instance;
      setModelStatus(modelName, "ready");
      console.log(
        `[TIMING] ${modelName}: ready in ${((performance.now() - _tStart) / 1000).toFixed(2)}s`,
      );
      return instance;
    })
    .catch((error) => {
      if (config.model === requestedModel) {
        setModelStatus(modelName, "error");
      }
      throw error;
    })
    .finally(() => {
      if (loadingPromises[modelName] === loadPromise) {
        delete loadingPromises[modelName];
      }
    });

  loadingPromises[modelName] = loadPromise;
  return loadPromise;
}

// Drop the cached pipeline and reload through loadModel so device/dtype stay in one path.
export async function setDetectionModel(modelId) {
  const option = MODEL_OPTIONS.find((item) => item.id === modelId && item.enabled);
  if (!option || (option.task !== "detection" && option.task !== "classification")) {
    throw new Error(`Unsupported model: ${modelId}`);
  }

  const slot = option.task === "classification" ? "classifier" : "objectDetector";
  if (MODEL_ID === modelId && isModelReady(slot)) {
    return models[slot];
  }

  const previousId = MODEL_ID;
  MODEL_ID = modelId;
  models.objectDetector = null;
  models.classifier = null;
  setModelStatus("objectDetector", "idle");
  setModelStatus("classifier", "idle");
  delete loadingPromises.objectDetector;
  delete loadingPromises.classifier;

  try {
    return await loadModel(slot);
  } catch (error) {
    MODEL_ID = previousId;
    await loadModel(getActiveSlot()).catch(() => {});
    throw error;
  }
}
