// Live RLS integration test for the unsorted-photo triage update policy
// (supabase/schema_place_photos_update_policy.sql). Every other test in
// this design mocks ./supabaseClient — RLS/column-grant guarantees can't
// be verified any other way, so this one deliberately talks to the real
// self-hosted instance. Same pattern as importCandidatesRls.live.test.ts.
//
// Opt-in only, never runs as part of the normal suite: real .env
// credentials are read directly from the .env file, and the whole file is
// skipped unless RUN_LIVE_SUPABASE_TESTS is set, since it creates/deletes
// real auth users and rows against a shared instance. Run this after
// applying the migration to production, and again after any future change
// to that migration file.
//
//   RUN_LIVE_SUPABASE_TESTS=1 bun run test -- unsortedPhotosRls.live

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadRealEnv(): Record<string, string> {
  const path = resolve(__dirname, "../../.env");
  const text = readFileSync(path, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

const shouldRun = Boolean(process.env.RUN_LIVE_SUPABASE_TESTS);

describe.skipIf(!shouldRun)("pinmap_place_photos update RLS (live)", () => {
  const env = shouldRun ? loadRealEnv() : ({} as Record<string, string>);
  const SUPABASE_URL = env.VITE_SUPABASE_URL;
  const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
  const SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;

  let admin: SupabaseClient;
  let userA: { id: string; email: string; client: SupabaseClient };
  let userB: { id: string; email: string; client: SupabaseClient };
  let photoId: string;

  async function createSignedInUser(email: string) {
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({ email, email_confirm: true });
    if (createErr || !created.user) {
      throw new Error(`createUser failed: ${createErr?.message}`);
    }

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link.properties?.email_otp) {
      throw new Error(`generateLink failed: ${linkErr?.message}`);
    }

    const verifyClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyErr } =
      await verifyClient.auth.verifyOtp({
        email,
        token: link.properties.email_otp,
        type: "email",
      });
    if (verifyErr || !verified.session) {
      throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
    }

    const client = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${verified.session.access_token}` },
      },
    });

    return { id: created.user.id, email, client };
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const stamp = Date.now();
    userA = await createSignedInUser(`unsorted-rls-a-${stamp}@example.invalid`);
    userB = await createSignedInUser(`unsorted-rls-b-${stamp}@example.invalid`);
  });

  afterAll(async () => {
    if (userA) await admin.auth.admin.deleteUser(userA.id);
    if (userB) await admin.auth.admin.deleteUser(userB.id);
  });

  beforeEach(async () => {
    const { data, error } = await admin
      .from("pinmap_place_photos")
      .insert({
        user_id: userA.id,
        place_query: null,
        storage_path: `${userA.id}/rls-test-${Date.now()}.jpg`,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`fixture insert failed: ${error?.message}`);
    }
    photoId = data.id;
  });

  it("a second user's UPDATE against the first user's row affects zero rows", async () => {
    const { data, error } = await userB.client
      .from("pinmap_place_photos")
      .update({ place_query: "Hijacked" })
      .eq("id", photoId)
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: stillNull } = await admin
      .from("pinmap_place_photos")
      .select("place_query")
      .eq("id", photoId)
      .single();
    expect(stillNull?.place_query).toBeNull();
  });

  it("the owner's UPDATE on a column other than place_query is rejected", async () => {
    const { error } = await userA.client
      .from("pinmap_place_photos")
      .update({ storage_path: "hijacked/path.jpg" })
      .eq("id", photoId);

    expect(error).not.toBeNull();
  });

  it("an UPDATE setting place_query to '' is rejected by the with check clause", async () => {
    const { data, error } = await userA.client
      .from("pinmap_place_photos")
      .update({ place_query: "" })
      .eq("id", photoId)
      .select();

    expect(data ?? []).toHaveLength(0);
    if (error === null) {
      // PostgREST reports a with-check violation as either an error or
      // (depending on version) a filtered-out row with no error — either
      // way, the row must not have been updated.
      const { data: unchanged } = await admin
        .from("pinmap_place_photos")
        .select("place_query")
        .eq("id", photoId)
        .single();
      expect(unchanged?.place_query).toBeNull();
    }
  });

  it("an UPDATE on an already-assigned row affects zero rows", async () => {
    const first = await userA.client
      .from("pinmap_place_photos")
      .update({ place_query: "Paris" })
      .eq("id", photoId)
      .select();
    expect(first.data).toHaveLength(1);

    const second = await userA.client
      .from("pinmap_place_photos")
      .update({ place_query: "Tokyo" })
      .eq("id", photoId)
      .select();
    expect(second.data).toHaveLength(0);

    const { data: stillParis } = await admin
      .from("pinmap_place_photos")
      .select("place_query")
      .eq("id", photoId)
      .single();
    expect(stillParis?.place_query).toBe("Paris");
  });

  afterEach(async () => {
    if (photoId) {
      await admin.from("pinmap_place_photos").delete().eq("id", photoId);
    }
  });
});
