import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapView } from "./MapView";
import type { GeocodeResult } from "../lib/geocoder";
import { BUILTIN_APPEARANCE_DEFAULTS } from "../lib/tagAppearance";
import { AIRPLANE_ICON_PATH, HOUSE_ICON_PATH } from "../lib/iconShapes";

const TEST_BUILTIN_APPEARANCE = BUILTIN_APPEARANCE_DEFAULTS;

const {
  instances,
  markerInstances,
  MockMap,
  MockMarker,
  MockPopup,
  MockLngLatBounds,
} = vi.hoisted(() => {
  const instances: InstanceType<typeof MockMap>[] = [];
  const markerInstances: InstanceType<typeof MockMarker>[] = [];

  class MockMap {
    options: unknown;
    flyToCalls: unknown[] = [];
    fitBoundsCalls: unknown[] = [];
    layerIds = new Set<string>();
    sourceCalls: unknown[] = [];
    paintPropertyCalls: { layerId: string; prop: string; value: unknown }[] =
      [];

    constructor(options: unknown) {
      this.options = options;
      instances.push(this);
    }
    remove(): void {}
    flyTo(opts: unknown): void {
      this.flyToCalls.push(opts);
    }
    fitBounds(bounds: unknown, opts: unknown): void {
      this.fitBoundsCalls.push({ bounds, opts });
    }
    getLayer(id: string): boolean {
      return this.layerIds.has(id);
    }
    addSource(id: string, options: unknown): void {
      this.sourceCalls.push({ id, options });
    }
    addLayer(options: { id: string }): void {
      this.layerIds.add(options.id);
    }
    setPaintProperty(layerId: string, prop: string, value: unknown): void {
      this.paintPropertyCalls.push({ layerId, prop, value });
    }
    isStyleLoaded(): boolean {
      return true;
    }
    on(event: string, handler: () => void): void {
      if (event === "load") {
        handler();
      }
    }
    once(event: string, handler: () => void): void {
      if (event === "load") {
        handler();
      }
    }
  }

  class MockMarker {
    options: { color?: string; element?: HTMLElement } | undefined;
    clickHandler: (() => void) | null = null;
    popup: MockPopup | undefined;
    lngLat: [number, number] | undefined;
    element = {
      title: "",
      style: { zIndex: "" },
      addEventListener: (event: string, handler: () => void) => {
        if (event === "click") this.clickHandler = handler;
      },
    };

    constructor(options?: { color?: string; element?: HTMLElement }) {
      this.options = options;
      markerInstances.push(this);
    }
    setLngLat(lngLat: [number, number]): MockMarker {
      this.lngLat = lngLat;
      return this;
    }
    setPopup(popup: MockPopup): MockMarker {
      this.popup = popup;
      return this;
    }
    addTo(): MockMarker {
      return this;
    }
    remove(): void {}
    getElement(): MockMarker["element"] {
      return this.element;
    }
  }

  class MockPopup {
    domContent: unknown;
    setText(): MockPopup {
      return this;
    }
    setDOMContent(content: unknown): MockPopup {
      this.domContent = content;
      return this;
    }
  }

  class MockLngLatBounds {
    extend(): MockLngLatBounds {
      return this;
    }
  }

  return {
    instances,
    markerInstances,
    MockMap,
    MockMarker,
    MockPopup,
    MockLngLatBounds,
  };
});

vi.mock("mapbox-gl", () => ({
  default: {
    Map: MockMap,
    Marker: MockMarker,
    Popup: MockPopup,
    LngLatBounds: MockLngLatBounds,
    accessToken: "",
  },
}));

const paris: GeocodeResult = {
  query: "paris",
  name: "Paris, France",
  lng: 2.35,
  lat: 48.86,
};
const tokyo: GeocodeResult = {
  query: "tokyo",
  name: "Tokyo, Japan",
  lng: 139.69,
  lat: 35.68,
};

beforeEach(() => {
  instances.length = 0;
  markerInstances.length = 0;
});

describe("MapView", () => {
  it("creates a map on mount", () => {
    render(
      <MapView
        token="pk.test"
        places={[]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(instances).toHaveLength(1);
  });

  it("flies to the single place when there is exactly one", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(instances[0]?.flyToCalls).toEqual([
      { center: [paris.lng, paris.lat], zoom: 10 },
    ]);
  });

  it("fits bounds to all places when there is more than one", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(instances[0]?.fitBoundsCalls).toHaveLength(1);
  });

  it("flies to the selected place", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={{ query: "tokyo", nonce: 1 }}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const flyToCalls = instances[0]?.flyToCalls ?? [];
    expect(flyToCalls[flyToCalls.length - 1]).toEqual({
      center: [tokyo.lng, tokyo.lat],
      zoom: 12,
    });
  });

  it("flies again when the same place is reselected with a new nonce", () => {
    const { rerender } = render(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={{ query: "tokyo", nonce: 1 }}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const flyToCallsBefore = instances[0]?.flyToCalls.length ?? 0;

    rerender(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={{ query: "tokyo", nonce: 2 }}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );

    expect(instances[0]?.flyToCalls.length).toBe(flyToCallsBefore + 1);
  });

  it("does not re-fly to the selection when places changes but the selection doesn't", () => {
    const selection = { query: "tokyo", nonce: 1 };
    const { rerender } = render(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={selection}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const flyToCallsBefore = instances[0]?.flyToCalls.length ?? 0;

    const mountainView: GeocodeResult = {
      query: "mountain view",
      name: "Mountain View, CA",
      lng: -122.08,
      lat: 37.42,
    };
    rerender(
      <MapView
        token="pk.test"
        places={[paris, tokyo, mountainView]}
        selection={selection}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );

    expect(instances[0]?.flyToCalls.length).toBe(flyToCallsBefore);
    expect(instances[0]?.fitBoundsCalls.length).toBeGreaterThan(0);
  });

  it("sets the marker's title to the pin's type label on hover", () => {
    const home = { ...paris, icon: "house-home" as const };
    render(
      <MapView
        token="pk.test"
        places={[home]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(markerInstances[0]?.element.title).toBe("Hometown");
  });

  it("sets the marker's title to a custom tag's label", () => {
    const tagged = {
      ...paris,
      customTag: {
        id: "marathon",
        label: "Marathon",
        color: "#8b5cf6",
        iconShape: "none" as const,
      },
    };
    render(
      <MapView
        token="pk.test"
        places={[tagged]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(markerInstances[0]?.element.title).toBe("Marathon");
  });

  it("leaves the marker untitled when the place has no type", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(markerInstances[0]?.element.title).toBe("");
  });

  it("colors a marker according to its category", () => {
    const visited = { ...paris, category: "visited" as const };
    render(
      <MapView
        token="pk.test"
        places={[visited]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(markerInstances[0]?.options).toEqual({ color: "#3b82f6" });
  });

  it("renders a custom triathlete marker element for a place tagged with the ironman icon", () => {
    const tagged = { ...paris, icon: "triathlete" as const };
    render(
      <MapView
        token="pk.test"
        places={[tagged]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    expect(marker?.options?.element).toBeInstanceOf(HTMLElement);
    expect(marker?.options?.color).toBeUndefined();
  });

  it("renders a custom house marker element for a place tagged with the home icon", () => {
    const tagged = { ...paris, icon: "house-home" as const };
    render(
      <MapView
        token="pk.test"
        places={[tagged]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    expect(marker?.options?.element).toBeInstanceOf(HTMLElement);
    expect(marker?.options?.color).toBeUndefined();
  });

  it("colors a marker with the 'lived' appearance for a place tagged with the live icon", () => {
    // "house-live" resolves to the "lived" builtin key, whose default
    // appearance has iconShape "none" — so it renders as a plain colored
    // dot (the lived color), not a house-badge element.
    const tagged = { ...paris, icon: "house-live" as const };
    render(
      <MapView
        token="pk.test"
        places={[tagged]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    expect(marker?.options).toEqual({
      color: TEST_BUILTIN_APPEARANCE.lived.color,
    });
  });

  it("renders a custom house marker element for a hometown place", () => {
    const home = { ...paris, category: "hometown" as const };
    render(
      <MapView
        token="pk.test"
        places={[home]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    expect(marker?.options?.element).toBeInstanceOf(HTMLElement);
    expect(marker?.options?.color).toBeUndefined();
  });

  it("colors a marker using a custom tag's color", () => {
    const tagged = {
      ...paris,
      customTag: {
        id: "marathon",
        label: "Marathon",
        color: "#8b5cf6",
        iconShape: "none" as const,
      },
    };
    render(
      <MapView
        token="pk.test"
        places={[tagged]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(markerInstances[0]?.options).toEqual({ color: "#8b5cf6" });
  });

  it("shows a legend only for categories actually present", () => {
    const visited = { ...paris, category: "visited" as const };
    const { container } = render(
      <MapView
        token="pk.test"
        places={[visited]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(container.textContent).toContain("Visited");
    expect(container.textContent).not.toContain("Hometown");
    expect(container.textContent).not.toContain("Lived");
  });

  it("shows no legend when no place has a category", () => {
    const { container } = render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(container.querySelector(".map-legend")).toBeNull();
  });

  it("calls onMarkerClick with the place's query when its marker is clicked", () => {
    const onMarkerClick = vi.fn();
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={onMarkerClick}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );

    markerInstances[0]?.clickHandler?.();

    expect(onMarkerClick).toHaveBeenCalledWith("paris");
  });

  it("does not move the camera when a marker is clicked", () => {
    const onMarkerClick = vi.fn();
    render(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={null}
        onMarkerClick={onMarkerClick}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const flyToCallsBefore = instances[0]?.flyToCalls.length ?? 0;
    const fitBoundsCallsBefore = instances[0]?.fitBoundsCalls.length ?? 0;

    markerInstances[0]?.clickHandler?.();

    expect(instances[0]?.flyToCalls.length).toBe(flyToCallsBefore);
    expect(instances[0]?.fitBoundsCalls.length).toBe(fitBoundsCallsBefore);
  });

  it("adds a US states fill layer and shades a state matching a categorized place's query", () => {
    const michigan = {
      ...paris,
      query: "Michigan",
      name: "Michigan, USA",
      category: "hometown" as const,
    };
    const { rerender } = render(
      <MapView
        token="pk.test"
        places={[]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const map = instances[0];
    expect(map?.getLayer("us-states-fill")).toBe(true);

    rerender(
      <MapView
        token="pk.test"
        places={[michigan]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );

    const lastFillCall = map?.paintPropertyCalls
      ?.filter(
        (call) =>
          call.layerId === "us-states-fill" && call.prop === "fill-color",
      )
      .at(-1);
    expect(lastFillCall?.value).toEqual([
      "match",
      ["get", "name"],
      "Michigan",
      "#eab308",
      "rgba(0, 0, 0, 0)",
    ]);
  });

  it("resets state colors to transparent when no place has a category", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const map = instances[0];
    const lastFillCall = map?.paintPropertyCalls
      ?.filter(
        (call) =>
          call.layerId === "us-states-fill" && call.prop === "fill-color",
      )
      .at(-1);
    expect(lastFillCall?.value).toBe("rgba(0, 0, 0, 0)");
  });

  it("creates markers in west-to-east order so an easterly pin renders on top of an overlapping westerly one", () => {
    render(
      <MapView
        token="pk.test"
        places={[tokyo, paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    // Tokyo (lng 139.69) is listed first, Paris (lng 2.35) second — but Paris
    // is farther west, so its marker must still be created (and therefore
    // appended to the DOM) first.
    expect(markerInstances[0]?.lngLat).toEqual([paris.lng, paris.lat]);
    expect(markerInstances[1]?.lngLat).toEqual([tokyo.lng, tokyo.lat]);
  });

  it("keeps west-to-east creation order when places are already sorted that way", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    expect(markerInstances[0]?.lngLat).toEqual([paris.lng, paris.lat]);
    expect(markerInstances[1]?.lngLat).toEqual([tokyo.lng, tokyo.lat]);
  });

  it("builds the popup content with the place name and a Google Maps link", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    const domContent = marker?.popup?.domContent as HTMLDivElement | undefined;
    expect(domContent?.textContent).toContain("Paris, France");
    const link = domContent?.querySelector("a");
    expect(link?.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${paris.lat},${paris.lng}`,
    );
    expect(link?.target).toBe("_blank");
    expect(link?.textContent).toBe("View on Google Maps");
  });

  it("gives the popup's relocate form an accessible input", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    const domContent = marker?.popup?.domContent as HTMLDivElement | undefined;
    const input = domContent?.querySelector("input");
    expect(input?.getAttribute("aria-label")).toBe(
      "Fix location for Paris, France",
    );
    expect(input?.placeholder).toContain("Paste a Google Maps link");
  });

  it("calls onSetLocation when the popup's relocate form is submitted with a Google Maps URL", () => {
    const onRelocate = vi.fn();
    const onSetLocation = vi.fn();
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={onRelocate}
        onSetLocation={onSetLocation}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    const domContent = marker?.popup?.domContent as HTMLDivElement;
    const input = domContent.querySelector("input") as HTMLInputElement;
    const form = domContent.querySelector("form") as HTMLFormElement;

    fireEvent.change(input, {
      target: {
        value:
          "https://www.google.com/maps/place/@37.7749,-122.4194,15z/data=!4m2!3m1!1s0x0!3e0!3d37.7749!4d-122.4194",
      },
    });
    fireEvent.submit(form);

    expect(onSetLocation).toHaveBeenCalledWith("paris", 37.7749, -122.4194);
    expect(onRelocate).not.toHaveBeenCalled();
  });

  it("calls onRelocate when the popup's relocate form is submitted with free text", () => {
    const onRelocate = vi.fn();
    const onSetLocation = vi.fn();
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={onRelocate}
        onSetLocation={onSetLocation}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    const domContent = marker?.popup?.domContent as HTMLDivElement;
    const input = domContent.querySelector("input") as HTMLInputElement;
    const form = domContent.querySelector("form") as HTMLFormElement;

    fireEvent.change(input, { target: { value: "Paris, Texas" } });
    fireEvent.submit(form);

    expect(onRelocate).toHaveBeenCalledWith("paris", "Paris, Texas");
    expect(onSetLocation).not.toHaveBeenCalled();
  });

  it("calls neither callback when the popup's relocate form is submitted empty", () => {
    const onRelocate = vi.fn();
    const onSetLocation = vi.fn();
    render(
      <MapView
        token="pk.test"
        places={[paris]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={onRelocate}
        onSetLocation={onSetLocation}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    const domContent = marker?.popup?.domContent as HTMLDivElement;
    const input = domContent.querySelector("input") as HTMLInputElement;
    const form = domContent.querySelector("form") as HTMLFormElement;

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(form);

    expect(onRelocate).not.toHaveBeenCalled();
    expect(onSetLocation).not.toHaveBeenCalled();
  });

  it("renders a place's marker using a custom builtinAppearance prop's color/iconShape", () => {
    const home = { ...paris, category: "hometown" as const };
    const customAppearance = {
      ...TEST_BUILTIN_APPEARANCE,
      hometown: { color: "#123456", iconShape: "airplane" as const },
    };
    render(
      <MapView
        token="pk.test"
        places={[home]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={customAppearance}
      />,
    );
    const marker = markerInstances[0];
    const element = marker?.options?.element as HTMLDivElement;
    expect(element.style.background).toContain("18, 52, 86");
    const path = element.querySelector("path");
    expect(path?.getAttribute("d")).toBe(AIRPLANE_ICON_PATH);
    expect(path?.getAttribute("d")).not.toBe(HOUSE_ICON_PATH);
  });

  it("re-renders an existing marker's appearance when builtinAppearance changes", () => {
    const home = { ...paris, category: "hometown" as const };
    const { rerender } = render(
      <MapView
        token="pk.test"
        places={[home]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const originalElement = markerInstances[0]?.options
      ?.element as HTMLDivElement;
    const originalBackground = originalElement.style.background;

    const changedAppearance = {
      ...TEST_BUILTIN_APPEARANCE,
      hometown: { color: "#654321", iconShape: "house" as const },
    };
    rerender(
      <MapView
        token="pk.test"
        places={[home]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={changedAppearance}
      />,
    );

    const updatedElement = markerInstances[markerInstances.length - 1]?.options
      ?.element as HTMLDivElement;
    expect(updatedElement.style.background).not.toBe(originalBackground);
    expect(updatedElement.style.background).toContain("101, 67, 33");
  });

  it("renders a place with icon 'airplane' using the airport key's appearance, with title Airport", () => {
    const tagged = { ...paris, icon: "airplane" as const };
    render(
      <MapView
        token="pk.test"
        places={[tagged]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    const element = marker?.options?.element as HTMLDivElement;
    const path = element.querySelector("path");
    expect(path?.getAttribute("d")).toBe(AIRPLANE_ICON_PATH);
    expect(marker?.element.title).toBe("Airport");
  });

  it("renders a custom tag's badge with its color and icon glyph when it has an iconShape", () => {
    const tagged = {
      ...paris,
      customTag: {
        id: "x",
        label: "X",
        color: "#00ff00",
        iconShape: "triathlete" as const,
      },
    };
    render(
      <MapView
        token="pk.test"
        places={[tagged]}
        selection={null}
        onMarkerClick={vi.fn()}
        onRelocate={vi.fn()}
        onSetLocation={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
      />,
    );
    const marker = markerInstances[0];
    const element = marker?.options?.element as HTMLDivElement;
    expect(element).toBeInstanceOf(HTMLElement);
    expect(element.style.background).toContain("0, 255, 0");
    expect(element.querySelector("circle")).not.toBeNull();
    expect(marker?.options?.color).toBeUndefined();
  });
});
