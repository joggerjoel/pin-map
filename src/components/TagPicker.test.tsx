import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagPicker } from "./TagPicker";

describe("TagPicker", () => {
  it("renders one button per tag option", () => {
    render(<TagPicker selectedTag={null} onSelect={vi.fn()} />);
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
    render(<TagPicker selectedTag={null} onSelect={vi.fn()} />);
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
    render(<TagPicker selectedTag={null} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: "Ironman" }));

    expect(onSelect).toHaveBeenCalledWith({
      kind: "icon",
      value: "triathlete",
    });
  });
});
