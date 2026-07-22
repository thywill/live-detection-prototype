import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.1";

const MODEL_CONFIG = {
  objectDetector: {
    task: "object-detection",
    model: "Xenova/detr-resnet-50",
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
  loadingPromises[modelName] = pipeline(config.task, config.model, {
    quantized: true,
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
