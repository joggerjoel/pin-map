import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapView } from "./MapView";
import type { GeocodeResult } from "../lib/geocoder";

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
    options: unknown;
    clickHandler: (() => void) | null = null;
    element = {
      addEventListener: (event: string, handler: () => void) => {
        if (event === "click") this.clickHandler = handler;
      },
    };

    constructor(options?: unknown) {
      this.options = options;
      markerInstances.push(this);
    }
    setLngLat(): MockMarker {
      return this;
    }
    setPopup(): MockMarker {
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
    setText(): MockPopup {
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
      />,
    );
    const flyToCallsBefore = instances[0]?.flyToCalls.length ?? 0;

    rerender(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={{ query: "tokyo", nonce: 2 }}
        onMarkerClick={vi.fn()}
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
      />,
    );

    expect(instances[0]?.flyToCalls.length).toBe(flyToCallsBefore);
    expect(instances[0]?.fitBoundsCalls.length).toBeGreaterThan(0);
  });

  it("colors a marker according to its category", () => {
    const visited = { ...paris, category: "visited" as const };
    render(
      <MapView
        token="pk.test"
        places={[visited]}
        selection={null}
        onMarkerClick={vi.fn()}
      />,
    );
    expect(markerInstances[0]?.options).toEqual({ color: "#3b82f6" });
  });

  it("shows a legend only for categories actually present", () => {
    const visited = { ...paris, category: "visited" as const };
    const { container } = render(
      <MapView
        token="pk.test"
        places={[visited]}
        selection={null}
        onMarkerClick={vi.fn()}
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
});
