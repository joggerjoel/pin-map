import { useState } from "react";
import type { FormEvent } from "react";

export interface LoginFormProps {
  onSendOtp: (email: string) => Promise<{ error: string | null }>;
  onVerifyOtp: (
    email: string,
    code: string,
  ) => Promise<{ error: string | null }>;
}

export function LoginForm({ onSendOtp, onVerifyOtp }: LoginFormProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSendOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (trimmed === "") return;
    setIsSubmitting(true);
    setError(null);
    const result = await onSendOtp(trimmed);
    setIsSubmitting(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setStep("code");
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed === "") return;
    setIsSubmitting(true);
    setError(null);
    const result = await onVerifyOtp(email.trim(), trimmed);
    setIsSubmitting(false);
    if (result.error !== null) {
      setError(result.error);
    }
  }

  if (step === "code") {
    return (
      <form className="login-form" onSubmit={handleVerifyOtp}>
        <p className="login-form__hint">We sent a code to {email}</p>
        <label htmlFor="login-code">Code</label>
        <input
          id="login-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="123456"
        />
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Verifying..." : "Verify"}
        </button>
        <button
          type="button"
          className="login-form__back"
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
          }}
        >
          Use a different email
        </button>
        {error !== null && <p className="login-form__error">{error}</p>}
      </form>
    );
  }

  return (
    <form className="login-form" onSubmit={handleSendOtp}>
      <label htmlFor="login-email">Email</label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
      />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending..." : "Send code"}
      </button>
      {error !== null && <p className="login-form__error">{error}</p>}
    </form>
  );
}
