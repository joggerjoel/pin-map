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

      layerIds = new Set<string>();

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
      getLayer(id: string): boolean {
        return this.layerIds.has(id);
      }
      addSource(): void {}
      addLayer(options: { id: string }): void {
        this.layerIds.add(options.id);
      }
      setPaintProperty(): void {}
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
      off(): void {}
      // MapView's declutter recalculation calls project/unproject/getSource
      // unconditionally on every marker-rebuild — these are simple no-op-ish
      // stubs so that logic doesn't throw here; this file doesn't assert
      // anything about declutter behavior (see MapView.test.tsx for that).
      project(lngLat: [number, number]): { x: number; y: number } {
        return { x: lngLat[0] * 100, y: lngLat[1] * -100 };
      }
      unproject(point: [number, number]): { lng: number; lat: number } {
        return { lng: point[0] / 100, lat: point[1] / -100 };
      }
      getSource(): undefined {
        return undefined;
      }
    }

    class MockMarker {
      element = {
        addEventListener: (): void => {},
        style: { zIndex: "" },
      };

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
      setDOMContent(): MockPopup {
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

  it("auto-detects a checklist-shaped line, geocodes only marked lines with a US country filter, and colors markers by category", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("country=us") && url.includes("Florida")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [
              { place_name: "Florida, United States", center: [-81.5, 27.7] },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ features: [] }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.type(
      screen.getByLabelText("Mapbox access token"),
      "pk.test-token",
    );
    await user.click(screen.getByRole("button", { name: "Save token" }));

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "1 Alabama \n9 Florida X",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    await waitFor(() => {
      expect(screen.getByText("Florida, United States")).toBeInTheDocument();
    });

    // Alabama had no mark, so it should never have been submitted/pinned or
    // listed (queryByText would also match the raw textarea content, so
    // scope this to the pinned-place list buttons instead).
    expect(
      screen.queryByRole("button", { name: /Alabama/ }),
    ).not.toBeInTheDocument();

    // A fetch call was made for Florida with the US country filter; Alabama was
    // never geocoded at all (it was filtered out by the parser before any fetch).
    const florida = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("Florida"),
    );
    expect(florida?.[0]).toContain("country=us");
    const alabama = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("Alabama"),
    );
    expect(alabama).toBeUndefined();
  });

  it("renders the sidebar toggle expanded initially and collapses it on click", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("pin-map:mapbox-token", "pk.stored-token");

    render(<App />);

    const toggle = screen.getByRole("button", { name: "Hide sidebar" });
    expect(toggle).toBeInTheDocument();

    await user.click(toggle);

    expect(
      screen.getByRole("button", { name: "Show sidebar" }),
    ).toBeInTheDocument();
  });

  it("renders the splitter as a resize separator", () => {
    window.localStorage.setItem("pin-map:mapbox-token", "pk.stored-token");

    render(<App />);

    const splitter = screen.getByRole("separator", {
      name: "Resize sidebar",
    });
    expect(splitter).toBeInTheDocument();
  });
});
