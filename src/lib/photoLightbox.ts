// A single shared fullscreen photo viewer, usable both from React
// components (PlaceList) and from MapView's popup content, which is built
// as plain DOM outside the React tree — a React-only solution (state,
// portal) couldn't be triggered from the popup's vanilla event handlers.

const OVERLAY_ID = "pin-map-photo-lightbox";

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closePhotoLightbox();
  }
}

export function openPhotoLightbox(url: string, alt: string): void {
  closePhotoLightbox();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "photo-lightbox";
  overlay.addEventListener("click", closePhotoLightbox);

  const img = document.createElement("img");
  img.src = url;
  img.alt = alt;
  overlay.appendChild(img);

  document.body.appendChild(overlay);
  document.addEventListener("keydown", handleKeydown);
}

export function closePhotoLightbox(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing !== null) {
    existing.remove();
    document.removeEventListener("keydown", handleKeydown);
  }
}
