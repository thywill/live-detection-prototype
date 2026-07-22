const overlayPreferences = {
  boxes: true,
  labels: true,
  face: true,
};

export function getOverlayPreferences() {
  return { ...overlayPreferences };
}

export function setOverlayPreference(key, value) {
  if (key in overlayPreferences) {
    overlayPreferences[key] = value;
  }
}

export function toggleOverlayPreference(key) {
  if (key in overlayPreferences) {
    overlayPreferences[key] = !overlayPreferences[key];
  }
  return overlayPreferences[key];
}

export function applyOverlayClasses(element) {
  if (!element) {
    return;
  }

  element.classList.toggle("overlay-boxes-hidden", !overlayPreferences.boxes);
  element.classList.toggle("overlay-labels-hidden", !overlayPreferences.labels);
  element.classList.toggle("overlay-face-hidden", !overlayPreferences.face);
}

export function applyOverlayClassesToAll(container, selector) {
  if (!container) {
    return;
  }

  for (const element of container.querySelectorAll(selector)) {
    applyOverlayClasses(element);
  }
}

export function syncOverlayToggleButtons(container) {
  if (!container) {
    return;
  }

  for (const button of container.querySelectorAll("[data-overlay]")) {
    const key = button.dataset.overlay;
    const isActive = overlayPreferences[key];
    button.classList.toggle("overlay-toggle--active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

export function wireOverlayToggleButtons(container, onToggle) {
  if (!container) {
    return;
  }

  for (const button of container.querySelectorAll("[data-overlay]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.overlay;
      toggleOverlayPreference(key);
      syncOverlayToggleButtons(container);
      if (typeof onToggle === "function") {
        onToggle(key);
      }
    });
  }

  syncOverlayToggleButtons(container);
}
