/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // fb-import-relay/ and notify-relay/ are separate Bun-only packages
    // (their own package.json, their own `bun test` runner) living as
    // subdirectories of this repo — exclude them explicitly, otherwise
    // Vitest's default discovery picks up their `bun:test`-importing test
    // files and fails to resolve them.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "fb-import-relay/**",
      "notify-relay/**",
      // bakeoff/ holds process-experiment artifacts, including held-out
      // acceptance tests meant to run only inside the experiment worktrees.
      "bakeoff/**",
    ],
    env: {
      VITE_MAPBOX_TOKEN: "",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_FB_IMPORT_UPLOAD_URL: "https://example.invalid/fb-import-upload",
      VITE_FB_IMPORT_RELAY_URL: "https://example.invalid/fb-import-relay",
      VITE_NOTIFY_RELAY_URL: "https://example.invalid/notify-relay",
    },
  },
});
