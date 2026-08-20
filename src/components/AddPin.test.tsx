import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddPin } from "./AddPin";

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
