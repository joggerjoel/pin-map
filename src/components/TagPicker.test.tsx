import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagPicker } from "./TagPicker";
import { getTagOrder, saveTagOrder } from "../lib/tagOrder";
import { BUILTIN_APPEARANCE_DEFAULTS } from "../lib/tagAppearance";
import {
  AIRPLANE_ICON_PATH,
  HOUSE_ICON_PATH,
  TRIATHLETE_ICON_BODY_PATH,
} from "../lib/iconShapes";

const TEST_BUILTIN_APPEARANCE = BUILTIN_APPEARANCE_DEFAULTS;

describe("TagPicker", () => {
  it("renders one button per tag option", () => {
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
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
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
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
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
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
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
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
        customTags={[
          {
            id: "marathon",
            label: "Marathon",
            color: "#8b5cf6",
            iconShape: "none",
          },
        ]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Marathon" }),
    ).toBeInTheDocument();
  });

  it("marks a custom tag as selected when it matches selectedTag", () => {
    const marathon = {
      id: "marathon",
      label: "Marathon",
      color: "#8b5cf6",
      iconShape: "none" as const,
    };
    render(
      <TagPicker
        selectedTag={{ kind: "custom", value: marathon }}
        onSelect={vi.fn()}
        customTags={[marathon]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Marathon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onSelect with the clicked custom tag", async () => {
    const onSelect = vi.fn();
    const marathon = {
      id: "marathon",
      label: "Marathon",
      color: "#8b5cf6",
      iconShape: "none" as const,
    };
    const user = userEvent.setup();
    render(
      <TagPicker
        selectedTag={null}
        onSelect={onSelect}
        customTags={[marathon]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
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
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
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
      "none",
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
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Create a custom pin type" }),
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateCustomTag).not.toHaveBeenCalled();
  });

  it("renders an Airport swatch (built-in #5) alongside the existing 4", () => {
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );
    for (const name of ["Visited", "Lived", "Hometown", "Ironman", "Airport"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("renders a built-in swatch's icon shape from the builtinAppearance prop", () => {
    const appearance = {
      ...TEST_BUILTIN_APPEARANCE,
      hometown: { color: "#eab308", iconShape: "airplane" as const },
    };
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={appearance}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );
    const hometownButton = screen.getByRole("button", { name: "Hometown" });
    const path = hometownButton.querySelector("path");
    expect(path?.getAttribute("d")).toBe(AIRPLANE_ICON_PATH);
    expect(path?.getAttribute("d")).not.toBe(HOUSE_ICON_PATH);
  });

  it("edits a built-in tag's color and icon shape via its edit form", async () => {
    const onEditBuiltinTag = vi.fn();
    const user = userEvent.setup();
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={onEditBuiltinTag}
        onEditCustomTag={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Hometown" }));
    const nameInput = screen.getByLabelText("Hometown name");
    expect(nameInput).toBeDisabled();

    const colorInput = screen.getByLabelText("Hometown color");
    fireEvent.change(colorInput, { target: { value: "#123456" } });
    const shapeSelect = screen.getByLabelText("Hometown icon shape");
    fireEvent.change(shapeSelect, { target: { value: "airplane" } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onEditBuiltinTag).toHaveBeenCalledWith("hometown", {
      color: "#123456",
      iconShape: "airplane",
    });
  });

  it("edits a custom tag's label, color, and icon shape via its edit form", async () => {
    const onEditCustomTag = vi.fn();
    const user = userEvent.setup();
    const marathon = {
      id: "marathon",
      label: "Marathon",
      color: "#8b5cf6",
      iconShape: "none" as const,
    };
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[marathon]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={onEditCustomTag}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Marathon" }));
    const nameInput = screen.getByLabelText("Marathon name");
    expect(nameInput).not.toBeDisabled();

    await user.clear(nameInput);
    await user.type(nameInput, "Ultra Marathon");
    fireEvent.change(screen.getByLabelText("Marathon color"), {
      target: { value: "#111111" },
    });
    fireEvent.change(screen.getByLabelText("Marathon icon shape"), {
      target: { value: "house" },
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onEditCustomTag).toHaveBeenCalledWith("marathon", {
      label: "Ultra Marathon",
      color: "#111111",
      iconShape: "house",
    });
  });

  it("closes the edit form without calling either edit callback when Cancel is clicked", async () => {
    const onEditBuiltinTag = vi.fn();
    const onEditCustomTag = vi.fn();
    const user = userEvent.setup();
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={onEditBuiltinTag}
        onEditCustomTag={onEditCustomTag}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Hometown" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Hometown color")).not.toBeInTheDocument();
    expect(onEditBuiltinTag).not.toHaveBeenCalled();
    expect(onEditCustomTag).not.toHaveBeenCalled();
  });

  it("renders a custom tag's icon shape in its swatch", () => {
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[
          { id: "x", label: "X", color: "#000", iconShape: "triathlete" },
        ]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );
    const xButton = screen.getByRole("button", { name: "X" });
    expect(xButton.querySelector("circle")).not.toBeNull();
    const path = xButton.querySelector("path");
    expect(path?.getAttribute("d")).toBe(TRIATHLETE_ICON_BODY_PATH);
  });
});

describe("TagPicker reordering", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders swatches in a previously saved order", () => {
    saveTagOrder(["category:hometown", "category:visited"]);
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );
    const buttons = screen
      .getAllByRole("button")
      .filter((button) =>
        ["Visited", "Lived", "Hometown", "Ironman"].includes(
          button.getAttribute("aria-label") ?? "",
        ),
      );
    expect(buttons[0]).toHaveAttribute("aria-label", "Hometown");
    expect(buttons[1]).toHaveAttribute("aria-label", "Visited");
  });

  it("persists a new order after a drag-and-drop reorder", () => {
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );

    const visited = screen.getByRole("button", { name: "Visited" });
    const hometown = screen.getByRole("button", { name: "Hometown" });

    const dragStartEvent = new Event("dragstart", { bubbles: true });
    visited.dispatchEvent(dragStartEvent);
    const dropEvent = new Event("drop", { bubbles: true });
    hometown.dispatchEvent(dropEvent);

    // Dragging "visited" (index 0) and dropping on "hometown" (index 2)
    // removes "visited" first, then re-inserts it at index 2 of the
    // now-shorter array — landing it directly after "hometown", ahead of
    // "ironman"/"airport"/"current". "lived" (untouched) stays in front.
    expect(getTagOrder()).toEqual([
      "category:lived",
      "category:hometown",
      "category:visited",
      "icon:triathlete",
      "icon:airplane",
      "icon:house-current",
    ]);
  });

  it("places a custom tag's swatch after existing built-ins by default (no saved order)", () => {
    const marathon = {
      id: "marathon",
      label: "Marathon",
      color: "#8b5cf6",
      iconShape: "none" as const,
    };
    render(
      <TagPicker
        selectedTag={null}
        onSelect={vi.fn()}
        customTags={[marathon]}
        onCreateCustomTag={vi.fn()}
        builtinAppearance={TEST_BUILTIN_APPEARANCE}
        onEditBuiltinTag={vi.fn()}
        onEditCustomTag={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Marathon" }),
    ).toBeInTheDocument();
  });
});
