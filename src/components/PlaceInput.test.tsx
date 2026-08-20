import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaceInput } from "./PlaceInput";

describe("PlaceInput", () => {
  it("calls onSubmit with the raw textarea value", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <PlaceInput onSubmit={onSubmit} isLoading={false} removedPlace={null} />,
    );

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "Paris{enter}Tokyo",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).toHaveBeenCalledWith("Paris\nTokyo", null);
  });

  it("does not call onSubmit when the textarea is empty", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <PlaceInput onSubmit={onSubmit} isLoading={false} removedPlace={null} />,
    );

    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the button and shows a loading label while isLoading", () => {
    render(
      <PlaceInput onSubmit={vi.fn()} isLoading={true} removedPlace={null} />,
    );
    expect(screen.getByRole("button", { name: "Pinning..." })).toBeDisabled();
  });

  it("submits a checklist-shaped line as-is (auto-detected downstream)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <PlaceInput onSubmit={onSubmit} isLoading={false} removedPlace={null} />,
    );

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "9 Florida X",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).toHaveBeenCalledWith("9 Florida X", null);
  });

  it("submits the selected continent", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <PlaceInput onSubmit={onSubmit} isLoading={false} removedPlace={null} />,
    );

    await user.selectOptions(screen.getByLabelText(/Continent/i), "europe");
    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "Paris",
    );
    await user.click(screen.getByRole("button", { name: "Pin Places" }));

    expect(onSubmit).toHaveBeenCalledWith("Paris", "europe");
  });

  it("strips the matching line from the textarea when a place is removed (plain mode)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PlaceInput onSubmit={vi.fn()} isLoading={false} removedPlace={null} />,
    );

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "Paris{enter}Tokyo",
    );

    rerender(
      <PlaceInput
        onSubmit={vi.fn()}
        isLoading={false}
        removedPlace={{ query: "Paris", nonce: 1 }}
      />,
    );

    expect(screen.getByLabelText("Paste places, one per line")).toHaveValue(
      "Tokyo",
    );
  });

  it("strips the matching line from the textarea when a place is removed (checklist-shaped line)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PlaceInput onSubmit={vi.fn()} isLoading={false} removedPlace={null} />,
    );

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "9 Florida X{enter}22 Michigan (home)",
    );

    rerender(
      <PlaceInput
        onSubmit={vi.fn()}
        isLoading={false}
        removedPlace={{ query: "Florida", nonce: 1 }}
      />,
    );

    expect(screen.getByLabelText("Paste places, one per line")).toHaveValue(
      "22 Michigan (home)",
    );
  });

  it("strips a date-prefixed line from the textarea when a place is removed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PlaceInput onSubmit={vi.fn()} isLoading={false} removedPlace={null} />,
    );

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "2017 | Dublin, Ireland{enter}Belfast, Ireland",
    );

    rerender(
      <PlaceInput
        onSubmit={vi.fn()}
        isLoading={false}
        removedPlace={{ query: "Dublin, Ireland", nonce: 1 }}
      />,
    );

    expect(screen.getByLabelText("Paste places, one per line")).toHaveValue(
      "Belfast, Ireland",
    );
  });

  it("strips a date-prefixed, tag-suffixed line from the textarea when a place is removed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PlaceInput onSubmit={vi.fn()} isLoading={false} removedPlace={null} />,
    );

    await user.type(
      screen.getByLabelText("Paste places, one per line"),
      "2015, 2016 | Chamonix, France (ironman){enter}Tokyo",
    );

    rerender(
      <PlaceInput
        onSubmit={vi.fn()}
        isLoading={false}
        removedPlace={{ query: "Chamonix, France", nonce: 1 }}
      />,
    );

    expect(screen.getByLabelText("Paste places, one per line")).toHaveValue(
      "Tokyo",
    );
  });

  it("does not change the textarea when removedPlace is null", () => {
    render(
      <PlaceInput onSubmit={vi.fn()} isLoading={false} removedPlace={null} />,
    );
    expect(screen.getByLabelText("Paste places, one per line")).toHaveValue("");
  });
});
