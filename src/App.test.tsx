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
      // Combined, ordered log of every camera command issued, so tests can
      // assert on the LAST command regardless of which method produced it.
      commands: Array<{ type: "flyTo" | "fitBounds"; opts: unknown }> = [];

      constructor(public options: unknown) {
        instances.push(this);
      }
      remove(): void {}
      flyTo(opts: unknown): void {
        this.flyToCalls.push(opts);
        this.commands.push({ type: "flyTo", opts });
      }
      fitBounds(bounds: unknown, opts: unknown): void {
        this.fitBoundsCalls.push({ bounds, opts });
        this.commands.push({ type: "fitBounds", opts: { bounds, opts } });
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

  it("shows the newly pinned place instead of hijacking the camera back to a prior selection", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("Paris")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              features: [
                { place_name: "Paris, France", center: [2.35, 48.86] },
              ],
            }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [{ place_name: "Tokyo, Japan", center: [139.69, 35.68] }],
          }),
        } as unknown as Response;
      }),
    );

    render(<App />);

    await user.type(
      screen.getByLabelText("Mapbox access token"),
      "pk.test-token",
    );
    await user.click(screen.getByRole("button", { name: "Save token" }));

    // Pin Paris, then select it in the sidebar.
    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "Paris",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));
    await waitFor(() => {
      expect(screen.getByText("Paris, France")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Paris, France" }));

    // Pin Tokyo next. This must fit bounds to both places, not fly back to
    // Paris just because `places` changed underneath the earlier selection.
    await user.clear(screen.getByLabelText("Paste places, one per line"));
    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "Tokyo",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));
    await waitFor(() => {
      expect(screen.getByText("Tokyo, Japan")).toBeInTheDocument();
    });

    const map = instances[0];
    expect(map).toBeDefined();
    const lastCommand = map?.commands[map.commands.length - 1];
    expect(lastCommand?.type).toBe("fitBounds");
  });

  it("returns to the token setup screen and clears the stored token when Change token is clicked", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("pin-map:mapbox-token", "pk.stored-token");

    render(<App />);

    expect(
      screen.queryByText(/Paste a Mapbox access token to get started/),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change token" }));

    expect(
      screen.getByText(/Paste a Mapbox access token to get started/),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("pin-map:mapbox-token")).toBeNull();
  });
});
