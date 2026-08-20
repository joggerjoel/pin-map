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
  }

  class MockMarker {
    options: unknown;

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
    render(<MapView token="pk.test" places={[]} selection={null} />);
    expect(instances).toHaveLength(1);
  });

  it("flies to the single place when there is exactly one", () => {
    render(<MapView token="pk.test" places={[paris]} selection={null} />);
    expect(instances[0]?.flyToCalls).toEqual([
      { center: [paris.lng, paris.lat], zoom: 10 },
    ]);
  });

  it("fits bounds to all places when there is more than one", () => {
    render(
      <MapView token="pk.test" places={[paris, tokyo]} selection={null} />,
    );
    expect(instances[0]?.fitBoundsCalls).toHaveLength(1);
  });

  it("flies to the selected place", () => {
    render(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={{ query: "tokyo", nonce: 1 }}
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
      />,
    );
    const flyToCallsBefore = instances[0]?.flyToCalls.length ?? 0;

    rerender(
      <MapView
        token="pk.test"
        places={[paris, tokyo]}
        selection={{ query: "tokyo", nonce: 2 }}
      />,
    );

    expect(instances[0]?.flyToCalls.length).toBe(flyToCallsBefore + 1);
  });

  it("does not re-fly to the selection when places changes but the selection doesn't", () => {
    const selection = { query: "tokyo", nonce: 1 };
    const { rerender } = render(
      <MapView token="pk.test" places={[paris, tokyo]} selection={selection} />,
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
      />,
    );

    expect(instances[0]?.flyToCalls.length).toBe(flyToCallsBefore);
    expect(instances[0]?.fitBoundsCalls.length).toBeGreaterThan(0);
  });

  it("colors a marker according to its category", () => {
    const visited = { ...paris, category: "visited" as const };
    render(<MapView token="pk.test" places={[visited]} selection={null} />);
    expect(markerInstances[0]?.options).toEqual({ color: "#3b82f6" });
  });

  it("shows a legend only for categories actually present", () => {
    const visited = { ...paris, category: "visited" as const };
    const { container } = render(
      <MapView token="pk.test" places={[visited]} selection={null} />,
    );
    expect(container.textContent).toContain("Visited");
    expect(container.textContent).not.toContain("Hometown");
    expect(container.textContent).not.toContain("Lived");
  });

  it("shows no legend when no place has a category", () => {
    const { container } = render(
      <MapView token="pk.test" places={[paris]} selection={null} />,
    );
    expect(container.querySelector(".map-legend")).toBeNull();
  });
});
