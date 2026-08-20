import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassRosterEditor } from "./ClassRosterEditor";
import * as classRosterRepositoryModule from "../lib/classRosterRepository";
import type { RosterPerson } from "../lib/classRosterRepository";

vi.mock("../lib/classRosterRepository", () => ({
  fetchRoster: vi.fn(),
  saveRosterPerson: vi.fn(),
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

    expect(screen.getByLabelText("High school name")).toHaveValue("Jane Smith");
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
    expect(screen.getByLabelText("Image URL")).toHaveValue(jane.imageUrl);
    expect(screen.getByLabelText("Image URL")).toHaveAttribute("readonly");
  });

  it("editing one name field does not change the other", async () => {
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.clear(screen.getByLabelText("Current name"));
    await user.type(screen.getByLabelText("Current name"), "Jane Doe");

    expect(screen.getByLabelText("Current name")).toHaveValue("Jane Doe");
    expect(screen.getByLabelText("High school name")).toHaveValue("Jane Smith");
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
    await user.type(screen.getByLabelText("Current name"), "  Bob Leeson  ");
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
          currentLocation: "Chicago",
        },
      );
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
  });

  it("warns before discarding unsaved edits when switching portraits", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<ClassRosterEditor classSlug="belding1989" />);

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.type(screen.getByLabelText("Current name"), "x");
    await user.click(screen.getByRole("button", { name: "Select Bob Lee" }));

    expect(confirmSpy).toHaveBeenCalled();
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
    await user.click(screen.getByRole("button", { name: "Select Bob Lee" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("High school name")).toHaveValue("Bob Lee");
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
});
