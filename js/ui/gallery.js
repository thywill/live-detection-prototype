import { openDeepAnalysis } from "./deep.js";

let galleryView = null;
let galleryGrid = null;
let galleryCountEl = null;
let galleryImages = [];
let onImagesChange = null;

function getCompareButton() {
  return document.getElementById("btn-compare");
}

function updateCompareButtonVisibility(hasImages) {
  const compareButton = getCompareButton();
  if (!compareButton) {
    return;
  }

  compareButton.style.display = hasImages ? "inline-flex" : "none";
}

function getSelectedCount() {
  if (!galleryGrid) {
    return 0;
  }

  return galleryGrid.querySelectorAll(".gallery-card__checkbox:checked").length;
}

function updateCompareButtonState() {
  const compareButton = getCompareButton();
  if (!compareButton) {
    return;
  }

  const isEnabled = getSelectedCount() >= 2;
  compareButton.classList.toggle("top-nav__compare--disabled", !isEnabled);
  compareButton.disabled = !isEnabled;
  compareButton.setAttribute("aria-disabled", String(!isEnabled));
}

function notifyImagesChange() {
  if (typeof onImagesChange === "function") {
    onImagesChange(galleryImages);
  }
}

function formatImageCount(count) {
  return count === 1 ? "1 image" : `${count} images`;
}

function handleOpenDeepAnalysis(imageId) {
  openDeepAnalysis(imageId, galleryImages);
}

function createPendingGalleryCard(image) {
  const card = document.createElement("article");
  card.className = "gallery-card gallery-card--pending";
  card.dataset.id = String(image.id);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "gallery-card__delete";
  deleteButton.setAttribute("aria-label", `Delete ${image.name}`);
  deleteButton.textContent = "×";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "gallery-card__checkbox";
  checkbox.setAttribute("aria-label", `Select ${image.name} for comparison`);
  checkbox.disabled = true;

  const imageWrap = document.createElement("div");
  imageWrap.className = "gallery-card__image-wrap";

  const shimmer = document.createElement("div");
  shimmer.className = "gallery-card__shimmer";
  shimmer.setAttribute("aria-hidden", "true");

  const colorStrip = document.createElement("div");
  colorStrip.className = "color-strip";

  imageWrap.append(shimmer, colorStrip);

  const meta = document.createElement("div");
  meta.className = "gallery-card__meta";

  const name = document.createElement("p");
  name.className = "gallery-card__name";
  name.textContent = image.name;

  const caption = document.createElement("p");
  caption.className = "gallery-card__caption";
  caption.textContent = "Analysing...";

  meta.append(name, caption);
  card.append(deleteButton, checkbox, imageWrap, meta);

  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeImage(image.id);
  });

  card.addEventListener("click", (event) => {
    if (
      event.target.closest(".gallery-card__checkbox") ||
      event.target.closest(".gallery-card__delete")
    ) {
      return;
    }
  });

  return card;
}

function createGalleryCard(image) {
  const card = document.createElement("article");
  card.className = "gallery-card";
  card.dataset.id = String(image.id);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "gallery-card__delete";
  deleteButton.setAttribute("aria-label", `Delete ${image.name}`);
  deleteButton.textContent = "×";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "gallery-card__checkbox";
  checkbox.setAttribute("aria-label", `Select ${image.name} for comparison`);

  const imageWrap = document.createElement("div");
  imageWrap.className = "gallery-card__image-wrap";

  const img = document.createElement("img");
  img.className = "gallery-card__image";
  img.src = image.src;
  img.alt = image.name;

  const colorStrip = document.createElement("div");
  colorStrip.className = "color-strip";

  imageWrap.append(img, colorStrip);

  const meta = document.createElement("div");
  meta.className = "gallery-card__meta";

  const name = document.createElement("p");
  name.className = "gallery-card__name";
  name.textContent = image.name;

  const caption = document.createElement("p");
  caption.className = "gallery-card__caption";
  caption.textContent = "Analysing...";

  meta.append(name, caption);
  card.append(deleteButton, checkbox, imageWrap, meta);

  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeImage(image.id);
  });

  checkbox.addEventListener("change", () => {
    card.classList.toggle("gallery-card--selected", checkbox.checked);
    updateCompareButtonState();
  });

  card.addEventListener("click", (event) => {
    if (
      event.target.closest(".gallery-card__checkbox") ||
      event.target.closest(".gallery-card__delete")
    ) {
      return;
    }
    handleOpenDeepAnalysis(image.id);
  });

  return card;
}

function selectAllCards() {
  if (!galleryGrid) {
    return;
  }

  for (const card of galleryGrid.querySelectorAll(".gallery-card")) {
    const checkbox = card.querySelector(".gallery-card__checkbox");
    if (checkbox && !checkbox.disabled) {
      checkbox.checked = true;
      card.classList.add("gallery-card--selected");
    }
  }

  updateCompareButtonState();
}

function clearAllCards() {
  if (!galleryGrid) {
    return;
  }

  for (const card of galleryGrid.querySelectorAll(".gallery-card")) {
    const checkbox = card.querySelector(".gallery-card__checkbox");
    if (checkbox) {
      checkbox.checked = false;
      card.classList.remove("gallery-card--selected");
    }
  }

  updateCompareButtonState();
}

export function initGallery(imagesChangeHandler) {
  const mainContent = document.getElementById("main-content");
  if (!mainContent || galleryView) {
    return;
  }

  onImagesChange = imagesChangeHandler;

  galleryView = document.createElement("div");
  galleryView.id = "gallery-view";
  galleryView.className = "gallery-view hidden";

  const bar = document.createElement("div");
  bar.className = "gallery-bar";

  galleryCountEl = document.createElement("span");
  galleryCountEl.className = "gallery-bar__count";
  galleryCountEl.textContent = formatImageCount(0);

  const actions = document.createElement("div");
  actions.className = "gallery-bar__actions";

  const selectAllButton = document.createElement("button");
  selectAllButton.type = "button";
  selectAllButton.id = "btn-select-all";
  selectAllButton.className = "btn btn--secondary gallery-bar__btn";
  selectAllButton.textContent = "Select All";

  const clearAllButton = document.createElement("button");
  clearAllButton.type = "button";
  clearAllButton.id = "btn-clear-all";
  clearAllButton.className = "btn btn--secondary gallery-bar__btn";
  clearAllButton.textContent = "Clear All";

  actions.append(selectAllButton, clearAllButton);
  bar.append(galleryCountEl, actions);

  galleryGrid = document.createElement("div");
  galleryGrid.className = "gallery-grid";

  galleryView.append(bar, galleryGrid);
  mainContent.appendChild(galleryView);

  selectAllButton.addEventListener("click", selectAllCards);
  clearAllButton.addEventListener("click", clearAllCards);
}

export function renderGallery(images) {
  if (!galleryView || !galleryGrid) {
    initGallery();
  }

  galleryImages = images;
  notifyImagesChange();

  const uploadZone = document.getElementById("upload-zone");
  if (images.length === 0) {
    updateCompareButtonVisibility(false);
    if (uploadZone) {
      uploadZone.classList.remove("hidden");
    }
    galleryView.classList.add("hidden");
    galleryGrid.replaceChildren();
    galleryCountEl.textContent = formatImageCount(0);
    updateCompareButtonState();
    return;
  }

  updateCompareButtonVisibility(true);
  if (uploadZone) {
    uploadZone.classList.add("hidden");
  }

  galleryView.classList.remove("hidden");
  galleryCountEl.textContent = formatImageCount(images.length);

  const existingIds = new Set(
    Array.from(galleryGrid.querySelectorAll(".gallery-card")).map(
      (card) => card.dataset.id,
    ),
  );

  for (const image of images) {
    if (existingIds.has(String(image.id))) {
      continue;
    }

    galleryGrid.appendChild(
      image.pending ? createPendingGalleryCard(image) : createGalleryCard(image),
    );
  }

  for (const card of galleryGrid.querySelectorAll(".gallery-card")) {
    if (!images.some((image) => String(image.id) === card.dataset.id)) {
      card.remove();
    }
  }

  updateCompareButtonState();
}

export function updateGalleryCard(image) {
  if (!galleryGrid) {
    return;
  }

  const existingCard = galleryGrid.querySelector(
    `.gallery-card[data-id="${String(image.id)}"]`,
  );

  if (existingCard) {
    const newCard = createGalleryCard(image);
    existingCard.replaceWith(newCard);
    updateCompareButtonState();
    return;
  }

  galleryGrid.appendChild(createGalleryCard(image));
  notifyImagesChange();
  updateCompareButtonState();
}

export function removeImage(imageId) {
  galleryImages = galleryImages.filter(
    (image) => String(image.id) !== String(imageId),
  );

  const card = galleryGrid?.querySelector(
    `.gallery-card[data-id="${String(imageId)}"]`,
  );
  if (card) {
    card.remove();
  }

  if (galleryCountEl) {
    galleryCountEl.textContent = formatImageCount(galleryImages.length);
  }

  if (galleryImages.length === 0) {
    updateCompareButtonVisibility(false);
    const uploadZone = document.getElementById("upload-zone");
    if (uploadZone) {
      uploadZone.classList.remove("hidden");
    }
    if (galleryView) {
      galleryView.classList.add("hidden");
    }
    if (galleryGrid) {
      galleryGrid.replaceChildren();
    }
  }

  updateCompareButtonState();
  notifyImagesChange();
  return galleryImages;
}

export function getSelectedImages() {
  if (!galleryGrid) {
    return [];
  }

  return Array.from(
    galleryGrid.querySelectorAll(".gallery-card__checkbox:checked"),
  ).map((checkbox) => {
    const card = checkbox.closest(".gallery-card");
    const id = card?.dataset.id;
    return id !== undefined && !Number.isNaN(Number(id)) ? Number(id) : id;
  });
}
