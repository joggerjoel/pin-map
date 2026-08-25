import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

describe("LoginForm", () => {
  it("renders the email step by default", () => {
    render(<LoginForm onSendOtp={vi.fn()} onVerifyOtp={vi.fn()} />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send code" }),
    ).toBeInTheDocument();
  });

  it("calls onSendOtp with the trimmed email on submit", async () => {
    const onSendOtp = vi.fn().mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "  a@b.com  ");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(onSendOtp).toHaveBeenCalledWith("a@b.com");
  });

  it("does not call onSendOtp when the email field is empty", async () => {
    const onSendOtp = vi.fn();
    const user = userEvent.setup();
    render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(onSendOtp).not.toHaveBeenCalled();
  });

  it("advances to the code step after a successful onSendOtp", async () => {
    const onSendOtp = vi.fn().mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(
      await screen.findByText("We sent a code to a@b.com"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
  });

  it("stays on the email step and shows the error on a failed onSendOtp", async () => {
    const onSendOtp = vi.fn().mockResolvedValue({ error: "some message" });
    const user = userEvent.setup();
    render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByText("some message")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("calls onVerifyOtp with the email and trimmed code from the code step", async () => {
    const onSendOtp = vi.fn().mockResolvedValue({ error: null });
    const onVerifyOtp = vi.fn().mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={onVerifyOtp} />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");

    await user.type(screen.getByLabelText("Code"), "  123456  ");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(onVerifyOtp).toHaveBeenCalledWith("a@b.com", "123456");
  });

  it("shows the error and stays on the code step on a failed onVerifyOtp", async () => {
    const onSendOtp = vi.fn().mockResolvedValue({ error: null });
    const onVerifyOtp = vi.fn().mockResolvedValue({ error: "bad code" });
    const user = userEvent.setup();
    render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={onVerifyOtp} />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");

    await user.type(screen.getByLabelText("Code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("bad code")).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
  });

  it("returns to the email step and clears the code field on 'Use a different email'", async () => {
    const onSendOtp = vi.fn().mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");

    await user.type(screen.getByLabelText("Code"), "123456");
    await user.click(
      screen.getByRole("button", { name: "Use a different email" }),
    );

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();

    // Go back to the code step to verify the field was actually cleared.
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");
    expect(screen.getByLabelText("Code")).toHaveValue("");
  });

  describe("rate-limit cooldown", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("disables the button with a countdown on a rate-limit error, then re-enables at zero", async () => {
      const onSendOtp = vi.fn().mockResolvedValue({
        error:
          "For security purposes, you can only request this after 2 seconds.",
      });
      const user = userEvent.setup({ delay: null });
      render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={vi.fn()} />);

      await user.type(screen.getByLabelText("Email"), "a@b.com");
      await user.click(screen.getByRole("button", { name: "Send code" }));

      const button = await screen.findByRole("button", {
        name: "Resend in 2s",
      });
      expect(button).toBeDisabled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(
        screen.getByRole("button", { name: "Resend in 1s" }),
      ).toBeDisabled();

      await vi.advanceTimersByTimeAsync(1000);
      const reenabled = screen.getByRole("button", { name: "Send code" });
      expect(reenabled).not.toBeDisabled();
    });

    it("does not start a countdown for a non-rate-limit error", async () => {
      const onSendOtp = vi.fn().mockResolvedValue({ error: "some message" });
      const user = userEvent.setup({ delay: null });
      render(<LoginForm onSendOtp={onSendOtp} onVerifyOtp={vi.fn()} />);

      await user.type(screen.getByLabelText("Email"), "a@b.com");
      await user.click(screen.getByRole("button", { name: "Send code" }));

      const button = await screen.findByRole("button", { name: "Send code" });
      expect(button).not.toBeDisabled();
    });
  });
});
