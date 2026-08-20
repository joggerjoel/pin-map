import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapView } from "./MapView";
import type { GeocodeResult } from "../lib/geocoder";

const { instances, MockMap, MockMarker, MockPopup, MockLngLatBounds } =
  vi.hoisted(() => {
    const instances: InstanceType<typeof MockMap>[] = [];

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

    return { instances, MockMap, MockMarker, MockPopup, MockLngLatBounds };
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
});

afterEach(() => {
  cleanup();
});

describe("MapView", () => {
  it("creates a map on mount", () => {
    render(<MapView token="pk.test" places={[]} selectedQuery={null} />);
    expect(instances).toHaveLength(1);
  });

  it("flies to the single place when there is exactly one", () => {
    render(<MapView token="pk.test" places={[paris]} selectedQuery={null} />);
    expect(instances[0]?.flyToCalls).toEqual([
      { center: [paris.lng, paris.lat], zoom: 10 },
    ]);
  });

  it("fits bounds to all places when there is more than one", () => {
    render(
      <MapView token="pk.test" places={[paris, tokyo]} selectedQuery={null} />,
    );
    expect(instances[0]?.fitBoundsCalls).toHaveLength(1);
  });

  it("flies to the selected place", () => {
    render(
      <MapView token="pk.test" places={[paris, tokyo]} selectedQuery="tokyo" />,
    );
    const flyToCalls = instances[0]?.flyToCalls ?? [];
    expect(flyToCalls[flyToCalls.length - 1]).toEqual({
      center: [tokyo.lng, tokyo.lat],
      zoom: 12,
    });
  });
});
