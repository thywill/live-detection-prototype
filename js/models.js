import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.1";

export const MODEL_ID = "Xenova/yolos-tiny";
const DTYPE = "auto";

let liveDetectionActive = false;

export function setLiveDetectionActive(active) {
  liveDetectionActive = Boolean(active);
}

const DEFAULT_DTYPE_BY_DEVICE = {
  webgpu: "fp16",
  wasm: "q8",
};

async function pickDevice() {
  if (!navigator.gpu) {
    return "wasm";
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

const resolvedDevicePromise = pickDevice();

function resolveDtypeForDevice(device) {
  // Keep this easy to override: set DTYPE to "q8"/"fp16"/"fp32" to force it.
  // When DTYPE is "auto", prefer fp16 on WebGPU and q8 on WASM fallback.
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
    model: MODEL_ID,
  },
  captioner: {
    task: "image-to-text",
    model: "Xenova/vit-gpt2-image-captioning",
  },
  emotionDetector: {
    task: "image-classification",
    model: "Xenova/facial-emotion-recognition",
  },
  sceneClassifier: {
    task: "image-classification",
    model: "Xenova/vit-base-patch16-224",
  },
};

const models = {
  objectDetector: null,
  captioner: null,
  emotionDetector: null,
  sceneClassifier: null,
};

export const modelStatus = {
  objectDetector: "idle",
  captioner: "idle",
  emotionDetector: "idle",
  sceneClassifier: "idle",
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
  if (liveDetectionActive && modelName !== "objectDetector") {
    throw new Error(
      `Live detection is active — refusing to load ${modelName}`,
    );
  }

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

  setModelStatus(modelName, "loading");

  // EXPERIMENT
  const _tStart = performance.now();
  console.log(`[TIMING] ${modelName}: loading started`);

  let pipelineOptions = { quantized: true };
  if (modelName === "objectDetector") {
    const device = await resolvedDevicePromise;
    const dtype = resolveDtypeForDevice(device);
    pipelineOptions = { device, dtype };
    console.log(`[BACKEND] device=${device} dtype=${dtype}`);
  }

  loadingPromises[modelName] = pipeline(config.task, config.model, {
    ...pipelineOptions,
  })
    .then((instance) => {
      models[modelName] = instance;
      setModelStatus(modelName, "ready");
      console.log(
        `[TIMING] ${modelName}: ready in ${((performance.now() - _tStart) / 1000).toFixed(2)}s`,
      );
      return instance;
    })
    .catch((error) => {
      setModelStatus(modelName, "error");
      throw error;
    })
    .finally(() => {
      delete loadingPromises[modelName];
    });

  return loadingPromises[modelName];
}
