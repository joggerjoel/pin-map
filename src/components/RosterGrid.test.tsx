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
  living: "Grand Rapids, Michigan",
  livingLat: 42.96,
  livingLng: -85.67,
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
  living: "",
  livingLat: null,
  livingLng: null,
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

    // onSelect is deferred past the double-click threshold so a genuine
    // double-click never fires it (see RosterGrid's handleClick) — a plain
    // single click still resolves it, just not synchronously.
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(jane);
    });
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

  it("opens the photo modal on double-click, without calling onSelect", async () => {
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

    await user.dblClick(
      screen.getByRole("button", { name: "Select Jane Smith Johnson" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Photos of Jane Smith Johnson" }),
    ).toBeInTheDocument();

    // Wait past the debounce window a genuine single click would resolve
    // after, to confirm the double-click actually canceled it rather than
    // merely not having fired yet.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("passes that person's photos and forwards onAddPhoto with the person attached", async () => {
    const onAddPhoto = vi.fn();
    const user = userEvent.setup();
    const photo = {
      id: "photo-1",
      personId: 1,
      storagePath: "user-1/a.jpg",
      year: 1995,
      url: "https://cdn.example.com/user-1/a.jpg",
    };
    render(
      <RosterGrid
        people={[jane, bob]}
        selectedId={null}
        searchText=""
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
        photosByPersonId={{ 1: [photo] }}
        onAddPhoto={onAddPhoto}
      />,
    );

    await user.dblClick(
      screen.getByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    expect(screen.getByText("1995")).toBeInTheDocument();

    const file = new File(["fake"], "recent.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Add a recent photo"), file);

    expect(onAddPhoto).toHaveBeenCalledWith(jane, file, null);
  });

  it("closes the photo modal when its close button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <RosterGrid
        people={[jane, bob]}
        selectedId={null}
        searchText=""
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await user.dblClick(
      screen.getByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an In Memoriam label for a person whose living field is RIP", () => {
    const deceased = { ...bob, living: "RIP" };
    render(
      <RosterGrid
        people={[jane, deceased]}
        selectedId={null}
        searchText=""
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const deceasedButton = screen.getByRole("button", {
      name: "Select Bob Lee",
    });
    expect(deceasedButton).toHaveTextContent("In Memoriam");
    expect(deceasedButton.className).toContain("--deceased");

    const livingButton = screen.getByRole("button", {
      name: "Select Jane Smith Johnson",
    });
    expect(livingButton).not.toHaveTextContent("In Memoriam");
    expect(livingButton.className).not.toContain("--deceased");
  });
});
