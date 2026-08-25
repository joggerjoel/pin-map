import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrderPicker } from "./OrderPicker";

describe("OrderPicker", () => {
  it("shows the current order as selected", () => {
    render(<OrderPicker order="oldest" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("oldest");
  });

  it("calls onChange with the newly selected order", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<OrderPicker order="newest" onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox"), "random");

    expect(onChange).toHaveBeenCalledWith("random");
  });
});
