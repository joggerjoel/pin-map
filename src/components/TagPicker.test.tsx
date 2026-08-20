import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagPicker } from "./TagPicker";

describe("TagPicker", () => {
  it("renders one button per tag option", () => {
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Visited" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lived" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hometown" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ironman" })).toBeInTheDocument();
  });

  it("marks the matching option as selected via aria-pressed", () => {
    render(
      <TagPicker
        selectedTag={{ kind: "category", value: "hometown" }}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Hometown" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Visited" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks nothing as selected when selectedTag is null", () => {
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
      />,
    );
    for (const name of ["Visited", "Lived", "Hometown", "Ironman"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });

  it("calls onSelect with the clicked option's tag", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <TagPicker
        selectedTag={null}
        onSelect={onSelect}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Ironman" }));

    expect(onSelect).toHaveBeenCalledWith({
      kind: "icon",
      value: "triathlete",
    });
  });

  it("renders a swatch for each custom tag", () => {
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[{ id: "marathon", label: "Marathon", color: "#8b5cf6" }]}
        onCreateCustomTag={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Marathon" }),
    ).toBeInTheDocument();
  });

  it("marks a custom tag as selected when it matches selectedTag", () => {
    const marathon = { id: "marathon", label: "Marathon", color: "#8b5cf6" };
    render(
      <TagPicker
        selectedTag={{ kind: "custom", value: marathon }}
        onSelect={vi.fn()}
        customTags={[marathon]}
        onCreateCustomTag={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Marathon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onSelect with the clicked custom tag", async () => {
    const onSelect = vi.fn();
    const marathon = { id: "marathon", label: "Marathon", color: "#8b5cf6" };
    const user = userEvent.setup();
    render(
      <TagPicker
        selectedTag={null}
        onSelect={onSelect}
        customTags={[marathon]}
        onCreateCustomTag={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Marathon" }));

    expect(onSelect).toHaveBeenCalledWith({ kind: "custom", value: marathon });
  });

  it("opens a creation form when the + button is clicked, and submits a new tag", async () => {
    const onCreateCustomTag = vi.fn();
    const user = userEvent.setup();
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={onCreateCustomTag}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Create a custom pin type" }),
    );
    await user.type(screen.getByLabelText("New pin type name"), "Marathon");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateCustomTag).toHaveBeenCalledWith(
      "Marathon",
      expect.any(String),
    );
  });

  it("does not submit the creation form with an empty name", async () => {
    const onCreateCustomTag = vi.fn();
    const user = userEvent.setup();
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={onCreateCustomTag}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Create a custom pin type" }),
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateCustomTag).not.toHaveBeenCalled();
  });
});
