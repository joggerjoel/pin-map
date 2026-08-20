import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const { instances, MockMap, MockMarker, MockPopup, MockLngLatBounds } =
  vi.hoisted(() => {
    const instances: InstanceType<typeof MockMap>[] = [];

    class MockMap {
      flyToCalls: unknown[] = [];
      fitBoundsCalls: unknown[] = [];

      constructor(public options: unknown) {
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

beforeEach(() => {
  window.localStorage.clear();
  instances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the token setup screen when no token is stored", () => {
    render(<App />);
    expect(
      screen.getByText(/Paste a Mapbox access token to get started/),
    ).toBeInTheDocument();
  });

  it("saves the token, geocodes pasted places, and lists them", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          features: [{ place_name: "Paris, France", center: [2.35, 48.86] }],
        }),
      } as unknown as Response),
    );

    render(<App />);

    await user.type(
      screen.getByLabelText("Mapbox access token"),
      "pk.test-token",
    );
    await user.click(screen.getByRole("button", { name: "Save token" }));

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "Paris",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    await waitFor(() => {
      expect(screen.getByText("Paris, France")).toBeInTheDocument();
    });
    expect(window.localStorage.getItem("pin-map:mapbox-token")).toBe(
      "pk.test-token",
    );
  });
});
