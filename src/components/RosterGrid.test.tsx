import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RosterGrid } from "./RosterGrid";
import type { RosterPerson } from "../lib/classRosterRepository";

const jane: RosterPerson = {
  id: 1,
  filename: "class1989-001_sheet1_row1_col1.png",
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  highSchoolName: "Jane Smith",
  currentName: "Jane Smith Johnson",
  hometown: "Belding, Michigan",
  currentLocation: "Grand Rapids, Michigan",
};

const bob: RosterPerson = {
  id: 2,
  filename: "class1989-002_sheet1_row1_col2.png",
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-002_sheet1_row1_col2.png",
  highSchoolName: "Bob Lee",
  currentName: "",
  hometown: "Belding, Michigan",
  currentLocation: "",
};

describe("RosterGrid", () => {
  it("renders every person and calls onSelect when clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <RosterGrid
        people={[jane, bob]}
        selectedId={null}
        searchText=""
        onSearchChange={vi.fn()}
        onSelect={onSelect}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Select Jane Smith Johnson" }),
    );

    expect(onSelect).toHaveBeenCalledWith(jane);
  });

  it("marks the selected person's button", () => {
    render(
      <RosterGrid
        people={[jane, bob]}
        selectedId={1}
        searchText=""
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Select Jane Smith Johnson" })
        .className,
    ).toContain("--selected");
  });

  it("filters by the given search text across both names", () => {
    render(
      <RosterGrid
        people={[jane, bob]}
        selectedId={null}
        searchText="bob"
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Select Jane Smith Johnson" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select Bob Lee" }),
    ).toBeInTheDocument();
  });

  it("calls onSearchChange as the search input changes", async () => {
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RosterGrid
        people={[jane, bob]}
        selectedId={null}
        searchText=""
        onSearchChange={onSearchChange}
        onSelect={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Search classmates"), "j");

    expect(onSearchChange).toHaveBeenCalledWith("j");
  });

  it("shows a loading indicator when isLoading is true", () => {
    render(
      <RosterGrid
        people={[]}
        selectedId={null}
        searchText=""
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
        isLoading
      />,
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows a placeholder initial when a portrait image fails to load", async () => {
    render(
      <RosterGrid
        people={[jane]}
        selectedId={null}
        searchText=""
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const img = screen.getByAltText("Jane Smith Johnson");

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
