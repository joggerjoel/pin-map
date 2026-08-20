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

  it("links to Mapbox signup and the access tokens console", () => {
    render(<TokenSetup onSubmit={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: "Create a free Mapbox account" }),
    ).toHaveAttribute(
      "href",
      "https://account.mapbox.com/auth/signup/?route-to=https%3A%2F%2Fconsole.mapbox.com%2F%3Fauth%3D1",
    );
    expect(
      screen.getByRole("link", { name: "access tokens page" }),
    ).toHaveAttribute(
      "href",
      "https://console.mapbox.com/account/access-tokens/",
    );
  });
});
