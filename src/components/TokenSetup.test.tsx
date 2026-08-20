import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TokenSetup } from "./TokenSetup";

describe("TokenSetup", () => {
  it("calls onSubmit with the trimmed token", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TokenSetup onSubmit={onSubmit} />);

    await user.type(
      screen.getByLabelText("Mapbox access token"),
      "  pk.my-token  ",
    );
    await user.click(screen.getByRole("button", { name: "Save token" }));

    expect(onSubmit).toHaveBeenCalledWith("pk.my-token");
  });

  it("does not call onSubmit when the input is empty", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TokenSetup onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Save token" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
