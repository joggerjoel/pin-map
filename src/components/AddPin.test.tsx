import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddPin } from "./AddPin";
import * as geocoderModule from "../lib/geocoder";
import * as mapboxTokenModule from "../lib/mapboxToken";

describe("AddPin", () => {
  it("defaults to the Visited icon and submits city + category", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddPin onAdd={onAdd} isLoading={false} />);

    await user.type(screen.getByLabelText("Add a pin"), "Paris");
    await user.click(screen.getByRole("button", { name: "Pin it" }));

    expect(onAdd).toHaveBeenCalledWith("Paris", {
      kind: "category",
      value: "visited",
    });
  });

  it("submits the chosen icon when a different swatch is selected", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddPin onAdd={onAdd} isLoading={false} />);

    await user.click(screen.getByRole("button", { name: "Ironman" }));
    await user.type(screen.getByLabelText("Add a pin"), "Kailua-Kona");
    await user.click(screen.getByRole("button", { name: "Pin it" }));

    expect(onAdd).toHaveBeenCalledWith("Kailua-Kona", {
      kind: "icon",
      value: "triathlete",
    });
  });

  it("does not submit when the city field is empty", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddPin onAdd={onAdd} isLoading={false} />);

    await user.click(screen.getByRole("button", { name: "Pin it" }));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("clears the city field after a successful submit", async () => {
    const user = userEvent.setup();
    render(<AddPin onAdd={vi.fn()} isLoading={false} />);

    await user.type(screen.getByLabelText("Add a pin"), "Paris");
    await user.click(screen.getByRole("button", { name: "Pin it" }));

    expect(screen.getByLabelText("Add a pin")).toHaveValue("");
  });

  it("disables the submit button and shows a loading label while isLoading", () => {
    render(<AddPin onAdd={vi.fn()} isLoading={true} />);
    expect(screen.getByRole("button", { name: "Pinning..." })).toBeDisabled();
  });
});

describe("AddPin autocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(mapboxTokenModule, "getMapboxToken").mockReturnValue("pk.test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows suggestions after typing and debouncing", async () => {
    vi.spyOn(geocoderModule, "searchPlaces").mockResolvedValue([
      { query: "Par", name: "Paris, France", lng: 2.35, lat: 48.86 },
    ]);
    const user = userEvent.setup({ delay: null });
    render(<AddPin onAdd={vi.fn()} isLoading={false} />);

    await user.type(screen.getByLabelText("Add a pin"), "Par");
    await vi.advanceTimersByTimeAsync(300);

    expect(
      await screen.findByRole("button", { name: "Paris, France" }),
    ).toBeInTheDocument();
  });

  it("fills the input with the clicked suggestion and clears the list", async () => {
    vi.spyOn(geocoderModule, "searchPlaces").mockResolvedValue([
      { query: "Par", name: "Paris, France", lng: 2.35, lat: 48.86 },
    ]);
    const user = userEvent.setup({ delay: null });
    render(<AddPin onAdd={vi.fn()} isLoading={false} />);

    await user.type(screen.getByLabelText("Add a pin"), "Par");
    await vi.advanceTimersByTimeAsync(300);
    await user.click(
      await screen.findByRole("button", { name: "Paris, France" }),
    );

    expect(screen.getByLabelText("Add a pin")).toHaveValue("Paris, France");
    expect(
      screen.queryByRole("button", { name: "Paris, France" }),
    ).not.toBeInTheDocument();
  });

  it("does not fetch suggestions for a 1-character query", async () => {
    const searchSpy = vi.spyOn(geocoderModule, "searchPlaces");
    const user = userEvent.setup({ delay: null });
    render(<AddPin onAdd={vi.fn()} isLoading={false} />);

    await user.type(screen.getByLabelText("Add a pin"), "P");
    await vi.advanceTimersByTimeAsync(300);

    expect(searchSpy).not.toHaveBeenCalled();
  });
});
