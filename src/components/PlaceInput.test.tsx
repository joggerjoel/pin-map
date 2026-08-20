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

    expect(onSubmit).toHaveBeenCalledWith("Paris\nTokyo", false, null);
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

  it("submits with checklistMode=true when the checkbox is checked", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PlaceInput onSubmit={onSubmit} isLoading={false} />);

    await user.click(screen.getByLabelText(/Checklist mode/i));
    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "9 Florida X",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).toHaveBeenCalledWith("9 Florida X", true, null);
  });

  it("submits the selected continent when not in checklist mode", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PlaceInput onSubmit={onSubmit} isLoading={false} />);

    await user.selectOptions(screen.getByLabelText(/Continent/i), "europe");
    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "Paris",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).toHaveBeenCalledWith("Paris", false, "europe");
  });

  it("ignores a selected continent when checklist mode is on", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PlaceInput onSubmit={onSubmit} isLoading={false} />);

    await user.selectOptions(screen.getByLabelText(/Continent/i), "europe");
    await user.click(screen.getByLabelText(/Checklist mode/i));
    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "9 Florida X",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).toHaveBeenCalledWith("9 Florida X", true, null);
  });
});
