import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaceInput } from "./PlaceInput";

describe("PlaceInput", () => {
  it("calls onSubmit with the raw textarea value", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PlaceInput onSubmit={onSubmit} isLoading={false} />);

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "Paris{enter}Tokyo",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).toHaveBeenCalledWith("Paris\nTokyo");
  });

  it("does not call onSubmit when the textarea is empty", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PlaceInput onSubmit={onSubmit} isLoading={false} />);

    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the button and shows a loading label while isLoading", () => {
    render(<PlaceInput onSubmit={vi.fn()} isLoading={true} />);
    expect(screen.getByRole("button", { name: "Pinning..." })).toBeDisabled();
  });
});
