import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { incrementLogin } from "../lib/tokenUsage";

export type AuthStatus = "loading" | "signed-out" | "signed-in";

export interface UseAuthResult {
  status: AuthStatus;
  email: string | null;
  userId: string | null;
  accessToken: string | null;
  sendOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, code: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setStatus(data.session ? "signed-in" : "signed-out");
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setStatus(newSession ? "signed-in" : "signed-out");
      },
    );
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const sendOtp = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    return { error: error ? error.message : null };
  }, []);

  const verifyOtp = useCallback(async (email: string, code: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (!error && data.session) {
      void incrementLogin();
    }
    return { error: error ? error.message : null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return {
    status,
    email: session?.user.email ?? null,
    userId: session?.user.id ?? null,
    accessToken: session?.access_token ?? null,
    sendOtp,
    verifyOtp,
    signOut,
  };
}
