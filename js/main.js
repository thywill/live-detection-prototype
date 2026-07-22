import { loadModel } from "./models.js";
import { initGallery, renderGallery, getSelectedImages, updateGalleryCard } from "./ui/gallery.js";
import { initSidebar, getSettings } from "./ui/sidebar.js";
import { openCompareView } from "./ui/compare.js";
import { initMobileView } from "./ui/mobile.js";
import { extractColors, renderColorStrip } from "./analysis/color.js";
import { generateCaption, updateGalleryCaption } from "./analysis/caption.js";
import { detectObjects, renderBoundingBoxes } from "./analysis/objects.js";
import { detectEmotion, shouldRunEmotion } from "./analysis/emotion.js";
import { analyzeComposition } from "./analysis/composition.js";
import {
  getAnalysisResult,
  storeAnalysisResult,
} from "./utils/export.js";

export let uploadedImages = [];
const MOBILE_BREAKPOINT = 768;

let galleryInitialized = false;
let uploadHandlersInitialized = false;
let mobileController = null;
let currentMode = null;

function isMobileViewport() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function upsertUploadedImage(image) {
  const index = uploadedImages.findIndex(
    (entry) => String(entry.id) === String(image.id),
  );

  if (index === -1) {
    uploadedImages.push(image);
    return;
  }

  uploadedImages[index] = image;
}

function dataUrlToFile(dataUrl, fileName) {
  const [header, base64Data] = String(dataUrl).split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] || "image/png";
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], fileName, { type: mimeType });
}

function showCameraFeedback(message) {
  const existing = document.getElementById("camera-feedback");
  if (existing) {
    existing.remove();
  }

  const feedback = document.createElement("p");
  feedback.id = "camera-feedback";
  feedback.className = "camera-feedback";
  feedback.textContent = message;
  document.body.appendChild(feedback);

  window.setTimeout(() => {
    feedback.remove();
  }, 4000);
}

async function requestCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("unsupported");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
  }
}

async function openCameraCaptureModal() {
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
  overlay.className = "camera-modal";
  overlay.innerHTML = `
    <div class="camera-modal__card" role="dialog" aria-modal="true" aria-label="Capture image">
      <video class="camera-modal__video" autoplay playsinline></video>
      <button type="button" class="camera-modal__capture" aria-label="Capture image"></button>
      <button type="button" class="camera-modal__cancel">Cancel</button>
    </div>
  `;

  const video = overlay.querySelector(".camera-modal__video");
  const captureButton = overlay.querySelector(".camera-modal__capture");
  const cancelButton = overlay.querySelector(".camera-modal__cancel");
  const card = overlay.querySelector(".camera-modal__card");

  function stopStream() {
    for (const track of stream?.getTracks?.() ?? []) {
      track.stop();
    }
  }

  function closeModal() {
    stopStream();
    overlay.remove();
  }

  captureButton.addEventListener("click", async () => {
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/png");
    const capturedFile = dataUrlToFile(
      dataUrl,
      `camera-capture-${Date.now()}.png`,
    );

    closeModal();
    processUploadedFiles([capturedFile]);
  });

  cancelButton.addEventListener("click", closeModal);

  overlay.addEventListener("click", (event) => {
    if (!card.contains(event.target)) {
      closeModal();
    }
  });

  document.body.appendChild(overlay);
  video.srcObject = stream;
  await video.play().catch(() => {});
}

async function runGalleryAnalysis(image) {
  const { analysisSettings, parameters } = getSettings();
  const existing = getAnalysisResult(image.id) ?? {};
  const analysisResult = {
    ...existing,
    analyzedAt: new Date().toISOString(),
  };

  const canvasTasks = [];

  if (analysisSettings.color && !existing.colors) {
    canvasTasks.push(
      extractColors(image.src, parameters.colorsToExtract).then((colors) => {
        analysisResult.colors = colors;
        renderColorStrip(image.id, colors);
      }),
    );
  }

  if (analysisSettings.composition && !existing.composition) {
    canvasTasks.push(
      analyzeComposition(image.src).then((composition) => {
        analysisResult.composition = composition;
      }),
    );
  }

  const modelTasks = [];

  if (analysisSettings.objects && !existing.objects) {
    modelTasks.push(
      detectObjects(image.src, {
        threshold: parameters.confidence,
        maxObjects: parameters.maxObjects,
      }).then((objects) => {
        analysisResult.objects = objects;
        const card = document.querySelector(
          `.gallery-card[data-id="${String(image.id)}"]`,
        );
        const galleryWrap = card?.querySelector(".gallery-card__image-wrap");
        const galleryImg = card?.querySelector(".gallery-card__image");
        renderBoundingBoxes(image.id, objects, true, galleryWrap, galleryImg);
      }),
    );
  }

  if (analysisSettings.caption && !existing.caption) {
    modelTasks.push(
      generateCaption(image.src).then((caption) => {
        analysisResult.caption = caption;
        updateGalleryCaption(image.id, caption);
      }),
    );
  }

  if (canvasTasks.length) {
    await Promise.all(canvasTasks);
  }

  if (modelTasks.length) {
    await Promise.all(modelTasks);
  }

  if (
    analysisSettings.emotion &&
    !existing.emotion &&
    shouldRunEmotion(analysisResult.objects ?? [])
  ) {
    try {
      analysisResult.emotion = await detectEmotion(image.src);
    } catch {
      // Gallery cards don't show emotion; result stored for deep view.
    }
  } else if (analysisSettings.emotion && !existing.emotion) {
    analysisResult.emotion = {
      primaryEmotion: "No face detected",
      primaryScore: 0,
      allEmotions: [],
    };
  }

  storeAnalysisResult(image.id, analysisResult);
}

function processUploadedFiles(files) {
  const imageFiles = Array.from(files).filter((file) =>
    file.type.startsWith("image/"),
  );

  if (imageFiles.length === 0) {
    return;
  }

  const baseId = Date.now();
  const pendingImages = imageFiles.map((file, index) => ({
    id: baseId + index,
    name: file.name,
    file,
    pending: true,
    src: "",
  }));

  uploadedImages = [...uploadedImages, ...pendingImages];
  renderGallery(uploadedImages);

  imageFiles.forEach((file, index) => {
    const placeholderId = baseId + index;
    const reader = new FileReader();

    reader.onload = () => {
      const imageIndex = uploadedImages.findIndex(
        (image) => image.id === placeholderId,
      );

      if (imageIndex === -1) {
        return;
      }

      uploadedImages[imageIndex] = {
        id: placeholderId,
        name: file.name,
        src: reader.result,
        file,
        pending: false,
      };

      updateGalleryCard(uploadedImages[imageIndex]);
      runGalleryAnalysis(uploadedImages[imageIndex]);
    };

    reader.readAsDataURL(file);
  });
}

function initUploadHandlers() {
  if (uploadHandlersInitialized) {
    return;
  }

  const fileInput = document.getElementById("file-input");
  const uploadButton = document.getElementById("btn-upload");
  const cameraButton = document.getElementById("btn-camera");
  const uploadZone = document.getElementById("upload-zone");

  if (!fileInput || !uploadButton || !uploadZone) {
    return;
  }

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) {
      processUploadedFiles(fileInput.files);
      fileInput.value = "";
    }
  });

  uploadButton.addEventListener("click", () => {
    fileInput.click();
  });

  if (cameraButton) {
    cameraButton.addEventListener("click", () => {
      openCameraCaptureModal();
    });
  }

  const compareButton = document.getElementById("btn-compare");
  if (compareButton) {
    compareButton.addEventListener("click", () => {
      const selectedIds = getSelectedImages();

      if (selectedIds.length < 2) {
        return;
      }

      openCompareView(selectedIds, uploadedImages);
    });
  }

  uploadZone.addEventListener("click", () => {
    fileInput.click();
  });

  uploadZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadZone.classList.add("upload-zone--active");
  });

  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("upload-zone--active");
  });

  uploadZone.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadZone.classList.remove("upload-zone--active");

    if (event.dataTransfer?.files?.length) {
      processUploadedFiles(event.dataTransfer.files);
    }
  });

  uploadHandlersInitialized = true;
}

function activateDesktopMode() {
  if (!galleryInitialized) {
    initGallery((images) => {
      uploadedImages = images;
    });
    galleryInitialized = true;
  }

  initUploadHandlers();
  renderGallery(uploadedImages);
}

function activateMobileMode() {
  mobileController = initMobileView({
    onImageStored(image) {
      upsertUploadedImage(image);
    },
    initialSessionItems: uploadedImages,
  });
}

function applyLayoutMode() {
  const nextMode = isMobileViewport() ? "mobile" : "desktop";
  if (nextMode === currentMode) {
    return;
  }

  if (mobileController) {
    mobileController.destroy();
    mobileController = null;
  }

  if (nextMode === "mobile") {
    activateMobileMode();
  } else {
    activateDesktopMode();
  }

  currentMode = nextMode;
}

document.addEventListener("DOMContentLoaded", () => {
  initSidebar();
  applyLayoutMode();
  window.addEventListener("resize", applyLayoutMode);

  loadModel("objectDetector").catch(() => {
    // Preload runs in background; errors surface when analysis runs.
  });
});
