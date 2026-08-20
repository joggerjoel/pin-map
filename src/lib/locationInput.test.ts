import { describe, expect, it, vi } from "vitest";
import { resolveLocationInput } from "./locationInput";

describe("resolveLocationInput", () => {
  it("calls onSetLocation when the text is a Google Maps URL", () => {
    const onRelocate = vi.fn();
    const onSetLocation = vi.fn();
    const url =
      "https://www.google.com/maps/place/Paris/@37.7749,-122.4194,15z/data=!4m2!3m1!1s0x0:0x0!3e0!3d37.7749!4d-122.4194";

    resolveLocationInput("Paris", url, onRelocate, onSetLocation);

    expect(onSetLocation).toHaveBeenCalledWith("Paris", 37.7749, -122.4194);
    expect(onRelocate).not.toHaveBeenCalled();
  });

  it("calls onSetLocation when the text is a raw lat,lng pair", () => {
    const onRelocate = vi.fn();
    const onSetLocation = vi.fn();

    resolveLocationInput("Paris", "48.8566, 2.3522", onRelocate, onSetLocation);

    expect(onSetLocation).toHaveBeenCalledWith("Paris", 48.8566, 2.3522);
    expect(onRelocate).not.toHaveBeenCalled();
  });

  it("calls onRelocate when the text is free-form search text", () => {
    const onRelocate = vi.fn();
    const onSetLocation = vi.fn();

    resolveLocationInput("Paris", "Paris, Texas", onRelocate, onSetLocation);

    expect(onRelocate).toHaveBeenCalledWith("Paris", "Paris, Texas");
    expect(onSetLocation).not.toHaveBeenCalled();
  });
});
