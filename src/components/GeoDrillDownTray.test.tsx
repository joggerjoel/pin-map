import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeoDrillDownTray } from "./GeoDrillDownTray";
import type { PinnedPlace } from "../hooks/useGeocoder";
import { BUILTIN_APPEARANCE_DEFAULTS } from "../lib/tagAppearance";

function place(
  name: string,
  lat: number,
  lng: number,
  extra: Partial<PinnedPlace> = {},
): PinnedPlace {
  return { query: name, name, lat, lng, ...extra };
}

const rutland = place("Rutland, Vermont, United States", 43.6, -72.97);
const burlington = place("Burlington, Vermont, United States", 44.48, -73.21);
const paris = place("Paris, France", 48.86, 2.35);

beforeEach(() => {
  window.localStorage.clear();
});

function renderTray(
  overrides: Partial<{
    places: PinnedPlace[];
    onSelectPlaces: ReturnType<typeof vi.fn>;
    onFocusPlaces: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return render(
    <GeoDrillDownTray
      places={overrides.places ?? []}
      builtinAppearance={BUILTIN_APPEARANCE_DEFAULTS}
      onSelectPlaces={overrides.onSelectPlaces ?? vi.fn()}
      onFocusPlaces={overrides.onFocusPlaces ?? vi.fn()}
    />,
  );
}

describe("GeoDrillDownTray", () => {
  it("renders nothing with no places", () => {
    const { container } = renderTray({ places: [] });
    expect(container.firstChild).toBeNull();
  });

  it("shows continents at the root, busiest first", () => {
    renderTray({ places: [rutland, burlington, paris] });
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("North America");
    expect(items[0]).toHaveTextContent("2");
    expect(items[1]).toHaveTextContent("Europe");
    expect(items[1]).toHaveTextContent("1");
  });

  it("drills down through country and state to reach a city leaf", async () => {
    const user = userEvent.setup();
    renderTray({ places: [rutland, burlington] });

    await user.click(screen.getByRole("listitem", { name: /North America/ }));
    expect(
      screen.getByRole("listitem", { name: /United States/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("listitem", { name: /United States/ }));
    expect(
      screen.getByRole("listitem", { name: /Vermont/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("listitem", { name: /Vermont/ }));
    expect(
      screen.getByRole("listitem", { name: /Rutland/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: /Burlington/ }),
    ).toBeInTheDocument();
  });

  it("calls onSelectPlaces with the city's places when a leaf is clicked", async () => {
    const onSelectPlaces = vi.fn();
    const user = userEvent.setup();
    renderTray({ places: [paris], onSelectPlaces });

    await user.click(screen.getByRole("listitem", { name: /Europe/ }));
    await user.click(screen.getByRole("listitem", { name: /France/ }));
    await user.click(screen.getByRole("listitem", { name: /Paris/ }));

    expect(onSelectPlaces).toHaveBeenCalledWith("Europe|France|Paris", [paris]);
  });

  it("breadcrumb navigation jumps back up the hierarchy", async () => {
    const user = userEvent.setup();
    renderTray({ places: [rutland] });

    await user.click(screen.getByRole("listitem", { name: /North America/ }));
    await user.click(screen.getByRole("listitem", { name: /United States/ }));
    expect(
      screen.getByRole("listitem", { name: /Vermont/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "World" }));
    expect(
      screen.getByRole("listitem", { name: /North America/ }),
    ).toBeInTheDocument();
  });

  it("collapses and expands, hiding the body when collapsed", async () => {
    const user = userEvent.setup();
    renderTray({ places: [rutland] });

    expect(
      screen.getByRole("listitem", { name: /North America/ }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Hide places browser" }),
    );
    expect(
      screen.queryByRole("listitem", { name: /North America/ }),
    ).not.toBeInTheDocument();
  });

  describe("focus on navigate", () => {
    it("calls onFocusPlaces with every place under the node when drilling into it", async () => {
      const onFocusPlaces = vi.fn();
      const user = userEvent.setup();
      renderTray({ places: [rutland, burlington], onFocusPlaces });

      await user.click(screen.getByRole("listitem", { name: /North America/ }));
      expect(onFocusPlaces).toHaveBeenCalledWith([rutland, burlington]);
    });

    it("calls onFocusPlaces with every place when a breadcrumb segment is clicked", async () => {
      const onFocusPlaces = vi.fn();
      const user = userEvent.setup();
      renderTray({ places: [rutland, burlington], onFocusPlaces });

      await user.click(screen.getByRole("listitem", { name: /North America/ }));
      await user.click(screen.getByRole("listitem", { name: /United States/ }));
      onFocusPlaces.mockClear();

      await user.click(screen.getByRole("button", { name: "World" }));
      expect(onFocusPlaces).toHaveBeenCalledWith([rutland, burlington]);
    });

    it("does not call onFocusPlaces when clicking a leaf (that's onSelectPlaces' job)", async () => {
      const onFocusPlaces = vi.fn();
      const user = userEvent.setup();
      renderTray({ places: [paris], onFocusPlaces });

      await user.click(screen.getByRole("listitem", { name: /Europe/ }));
      await user.click(screen.getByRole("listitem", { name: /France/ }));
      onFocusPlaces.mockClear();

      await user.click(screen.getByRole("listitem", { name: /Paris/ }));
      expect(onFocusPlaces).not.toHaveBeenCalled();
    });
  });

  describe("dominant tag icon per item", () => {
    it("shows an icon swatch for an item whose places carry a tag", () => {
      const ironmanRutland = { ...rutland, icon: "triathlete" as const };
      const { container } = renderTray({ places: [ironmanRutland] });
      expect(
        container.querySelector(".geo-tray__item-icon"),
      ).toBeInTheDocument();
    });

    it("shows no icon swatch for an item with no tagged places", () => {
      const { container } = renderTray({ places: [paris] });
      expect(container.querySelector(".geo-tray__item-icon")).toBeNull();
    });
  });
});
