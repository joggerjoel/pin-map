/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // fb-import-relay/ is a separate Bun-only package (its own package.json,
    // its own `bun test` runner) living as a subdirectory of this repo —
    // exclude it explicitly, otherwise Vitest's default discovery picks up
    // its `bun:test`-importing test files and fails to resolve them.
    exclude: ["**/node_modules/**", "**/dist/**", "fb-import-relay/**"],
    env: {
      VITE_MAPBOX_TOKEN: "",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_FB_IMPORT_UPLOAD_URL: "https://example.invalid/fb-import-upload",
      VITE_FB_IMPORT_RELAY_URL: "https://example.invalid/fb-import-relay",
    },
  },
});
