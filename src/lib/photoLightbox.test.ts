import { afterEach, describe, expect, it } from "vitest";
import { closePhotoLightbox, openPhotoLightbox } from "./photoLightbox";

afterEach(() => {
  closePhotoLightbox();
});

describe("openPhotoLightbox", () => {
  it("appends a fullscreen overlay with the photo to the document body", () => {
    openPhotoLightbox("https://cdn.example.com/photo.jpg", "Photo of Paris");

    const overlay = document.querySelector(".photo-lightbox");
    expect(overlay).not.toBeNull();
    const img = overlay?.querySelector("img");
    expect(img?.src).toBe("https://cdn.example.com/photo.jpg");
    expect(img?.alt).toBe("Photo of Paris");
  });

  it("replaces an already-open lightbox rather than stacking a second one", () => {
    openPhotoLightbox("https://cdn.example.com/a.jpg", "A");
    openPhotoLightbox("https://cdn.example.com/b.jpg", "B");

    expect(document.querySelectorAll(".photo-lightbox")).toHaveLength(1);
    expect(document.querySelector("img")?.src).toBe(
      "https://cdn.example.com/b.jpg",
    );
  });

  it("closes when the overlay is clicked", () => {
    openPhotoLightbox("https://cdn.example.com/photo.jpg", "Photo of Paris");

    document
      .querySelector(".photo-lightbox")
      ?.dispatchEvent(new Event("click", { bubbles: true }));

    expect(document.querySelector(".photo-lightbox")).toBeNull();
  });

  it("closes on Escape", () => {
    openPhotoLightbox("https://cdn.example.com/photo.jpg", "Photo of Paris");

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(document.querySelector(".photo-lightbox")).toBeNull();
  });
});

describe("closePhotoLightbox", () => {
  it("does nothing when no lightbox is open", () => {
    expect(() => closePhotoLightbox()).not.toThrow();
  });
});
