import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassRosterEditor } from "./ClassRosterEditor";
import * as classRosterRepositoryModule from "../lib/classRosterRepository";
import type { RosterPerson } from "../lib/classRosterRepository";
import * as geocoderModule from "../lib/geocoder";

vi.mock("../lib/classRosterRepository", () => ({
  fetchRoster: vi.fn(),
  saveRosterPerson: vi.fn(),
}));

vi.mock("../lib/geocoder", () => ({
  geocodeLine: vi.fn(),
}));

const jane: RosterPerson = {
  id: 1,
  filename: "class1989-001_sheet1_row1_col1.png",
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  highSchoolName: "Jane Smith",
  currentName: "Jane Smith Johnson",
  hometown: "Belding, Michigan",
  living: "Grand Rapids, Michigan",
  livingLat: 42.96,
  livingLng: -85.67,
  currentLocation: "Chicago, Illinois",
};

const bob: RosterPerson = {
  id: 2,
  filename: "class1989-002_sheet1_row1_col2.png",
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-002_sheet1_row1_col2.png",
  highSchoolName: "Bob Lee",
  currentName: "",
  hometown: "Belding, Michigan",
  living: "",
  livingLat: null,
  livingLng: null,
  currentLocation: "",
};

beforeEach(() => {
  vi.mocked(classRosterRepositoryModule.fetchRoster).mockResolvedValue([
    jane,
    bob,
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ClassRosterEditor", () => {
  it("fetches and renders the roster for the given class", async () => {
    render(<ClassRosterEditor classSlug="belding1989" />);

    expect(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select Bob Lee" }),
    ).toBeInTheDocument();
    expect(classRosterRepositoryModule.fetchRoster).toHaveBeenCalledWith(
      "belding1989",
    );
  });

  it("loads a person's existing values into the panel when selected", async () => {
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );

    expect(await screen.findByLabelText("Birth name")).toHaveValue(
      "Jane Smith",
    );
    expect(screen.getByLabelText("Current name")).toHaveValue(
      "Jane Smith Johnson",
    );
    expect(screen.getByLabelText("Hometown")).toHaveValue("Belding, Michigan");
    expect(screen.getByLabelText("Living")).toHaveValue(
      "Grand Rapids, Michigan",
    );
    expect(screen.getByLabelText("Current location")).toHaveValue(
      "Chicago, Illinois",
    );
  });

  it("editing one name field does not change the other", async () => {
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.clear(await screen.findByLabelText("Current name"));
    await user.type(screen.getByLabelText("Current name"), "Jane Doe");

    expect(screen.getByLabelText("Current name")).toHaveValue("Jane Doe");
    expect(screen.getByLabelText("Birth name")).toHaveValue("Jane Smith");
  });

  it("trims whitespace and saves all five fields on Save", async () => {
    vi.mocked(classRosterRepositoryModule.saveRosterPerson).mockResolvedValue(
      true,
    );
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Bob Lee" }),
    );
    await user.type(
      await screen.findByLabelText("Current name"),
      "  Bob Leeson  ",
    );
    await user.type(screen.getByLabelText("Living"), "  Detroit  ");
    await user.type(screen.getByLabelText("Current location"), "  Chicago  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(classRosterRepositoryModule.saveRosterPerson).toHaveBeenCalledWith(
        "belding1989",
        {
          id: 2,
          highSchoolName: "Bob Lee",
          currentName: "Bob Leeson",
          hometown: "Belding, Michigan",
          living: "Detroit",
          livingLat: null,
          livingLng: null,
          currentLocation: "Chicago",
        },
      );
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("geocodes the living field and caches its coordinates when it changes", async () => {
    vi.mocked(classRosterRepositoryModule.saveRosterPerson).mockResolvedValue(
      true,
    );
    vi.mocked(geocoderModule.geocodeLine).mockResolvedValue({
      query: "Detroit",
      name: "Detroit, Michigan, USA",
      lat: 42.33,
      lng: -83.05,
    });
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" token="pk.test" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Bob Lee" }),
    );
    await user.type(await screen.findByLabelText("Living"), "Detroit");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(classRosterRepositoryModule.saveRosterPerson).toHaveBeenCalledWith(
        "belding1989",
        expect.objectContaining({
          living: "Detroit",
          livingLat: 42.33,
          livingLng: -83.05,
        }),
      );
    });
    expect(geocoderModule.geocodeLine).toHaveBeenCalledWith(
      "Detroit",
      "pk.test",
      "us",
    );
  });

  it("does not re-geocode when living is unchanged, reusing the cached coordinates", async () => {
    vi.mocked(classRosterRepositoryModule.saveRosterPerson).mockResolvedValue(
      true,
    );
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" token="pk.test" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.type(await screen.findByLabelText("Current name"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(classRosterRepositoryModule.saveRosterPerson).toHaveBeenCalledWith(
        "belding1989",
        expect.objectContaining({
          living: jane.living,
          livingLat: jane.livingLat,
          livingLng: jane.livingLng,
        }),
      );
    });
    expect(geocoderModule.geocodeLine).not.toHaveBeenCalled();
  });

  it("clears the cached coordinates without geocoding when living is cleared", async () => {
    vi.mocked(classRosterRepositoryModule.saveRosterPerson).mockResolvedValue(
      true,
    );
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" token="pk.test" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.clear(await screen.findByLabelText("Living"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(classRosterRepositoryModule.saveRosterPerson).toHaveBeenCalledWith(
        "belding1989",
        expect.objectContaining({
          living: "",
          livingLat: null,
          livingLng: null,
        }),
      );
    });
    expect(geocoderModule.geocodeLine).not.toHaveBeenCalled();
  });

  it("shows an error state when saving fails", async () => {
    vi.mocked(classRosterRepositoryModule.saveRosterPerson).mockResolvedValue(
      false,
    );
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Bob Lee" }),
    );
    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
  });

  it("warns before discarding unsaved edits when switching portraits", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.type(await screen.findByLabelText("Current name"), "x");
    await user.click(screen.getByRole("button", { name: "Select Bob Lee" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });
    // Declining the confirm keeps the original selection's edited value.
    expect(screen.getByLabelText("Current name")).toHaveValue(
      "Jane Smith Johnsonx",
    );
  });

  it("switches portraits without prompting when there are no unsaved edits", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await screen.findByLabelText("Birth name");
    await user.click(screen.getByRole("button", { name: "Select Bob Lee" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Birth name")).toHaveValue("Bob Lee");
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("filters the grid by search text across both names", async () => {
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);
    await screen.findByRole("button", { name: "Select Jane Smith Johnson" });

    await user.type(screen.getByLabelText("Search classmates"), "bob");

    expect(
      screen.queryByRole("button", { name: "Select Jane Smith Johnson" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select Bob Lee" }),
    ).toBeInTheDocument();
  });

  it("shows a placeholder when a portrait image fails to load", async () => {
    render(<ClassRosterEditor classSlug="belding1989" />);
    const img = await screen.findByAltText("Jane Smith Johnson");

    img.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(
        screen.queryByAltText("Jane Smith Johnson"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Select Jane Smith Johnson" }),
    ).toHaveTextContent("J");
  });

  it("opens the photo modal on double-click even with unsaved edits pending, without prompting to discard them", async () => {
    // Regression: a plain single-click select can trigger a blocking
    // window.confirm() (the unsaved-edit guard below). If that fired
    // synchronously on the first click of a double-click, the native
    // dialog would interrupt the browser mid-gesture and onDoubleClick
    // would never fire at all — this is what "double click doesn't work
    // in edit roster" turned out to be.
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.type(await screen.findByLabelText("Current name"), "x");

    await user.dblClick(
      screen.getByRole("button", { name: "Select Jane Smith Johnson" }),
    );

    // The dialog reflects the roster's saved data — "x" is still an
    // unsaved draft in the panel's form, not yet persisted to the person
    // record the grid (and modal) render from.
    expect(
      await screen.findByRole("dialog", {
        name: "Photos of Jane Smith Johnson",
      }),
    ).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
