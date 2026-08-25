// Live RLS/RPC integration test for pinmap_import_candidates,
// pinmap_import_candidate_photos, the import-staging bucket, and
// approve_import_candidate(). Every other test in this repo mocks
// ./supabaseClient entirely (see vitest.config's faked VITE_SUPABASE_URL) —
// this one deliberately talks to the real self-hosted instance, because RLS
// policies and a Postgres RPC function can't be verified any other way.
//
// Opt-in only, never runs as part of the normal suite: real .env
// credentials are read directly from the .env file (bypassing vitest's
// faked env), and the whole file is skipped unless RUN_LIVE_SUPABASE_TESTS
// is set, since it creates/deletes real auth users and rows against a
// shared instance.
//
//   RUN_LIVE_SUPABASE_TESTS=1 bun run test -- importCandidatesRls.live

import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe.skipIf(!shouldRun)("pinmap_import_candidates RLS + RPC (live)", () => {
  const env = shouldRun ? loadRealEnv() : ({} as Record<string, string>);
  const SUPABASE_URL = env.VITE_SUPABASE_URL;
  const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
  const SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;

  let admin: SupabaseClient;
  let userA: { id: string; email: string; client: SupabaseClient };
  let userB: { id: string; email: string; client: SupabaseClient };

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

    // `hashed_token` + type "magiclink"/"email" both 403 as "otp_expired" on
    // this self-hosted GoTrue version — the plain 6-digit `email_otp` code
    // (the same one that'd be emailed to a real user) is what actually
    // verifies. Confirmed by hand against the live instance before relying
    // on it here.
    //
    // A throwaway client does the verification; Node has no real
    // localStorage, so supabase-js's session storage falls back to a
    // shared in-memory adapter that multiple createClient() instances for
    // the same URL can collide on. Rather than trust that client's ongoing
    // session, pull out the raw access token and hand it to a fresh client
    // via an explicit Authorization header — no shared session storage
    // involved at all.
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
    userA = await createSignedInUser(`rls-test-a-${stamp}@example.invalid`);
    userB = await createSignedInUser(`rls-test-b-${stamp}@example.invalid`);
  });

  afterAll(async () => {
    if (userA) await admin.auth.admin.deleteUser(userA.id);
    if (userB) await admin.auth.admin.deleteUser(userB.id);
  });

  it("lets a user insert and read their own candidate, but not another user's", async () => {
    const { data: inserted, error: insertErr } = await userA.client
      .from("pinmap_import_candidates")
      .insert({
        user_id: userA.id,
        external_key: `rls-test-${Date.now()}`,
        place_name: "Test Place",
        visit_time: new Date().toISOString(),
      })
      .select()
      .single();
    expect(insertErr).toBeNull();
    expect(inserted?.user_id).toBe(userA.id);

    const { data: ownRead } = await userA.client
      .from("pinmap_import_candidates")
      .select("id")
      .eq("id", inserted!.id);
    expect(ownRead).toHaveLength(1);

    // RLS filters silently rather than erroring — B sees zero rows, not a
    // permission error.
    const { data: otherRead, error: otherErr } = await userB.client
      .from("pinmap_import_candidates")
      .select("id")
      .eq("id", inserted!.id);
    expect(otherErr).toBeNull();
    expect(otherRead).toHaveLength(0);

    const { data: otherUpdate } = await userB.client
      .from("pinmap_import_candidates")
      .update({ place_name: "Hijacked" })
      .eq("id", inserted!.id)
      .select();
    expect(otherUpdate).toHaveLength(0);

    const { data: stillThere } = await admin
      .from("pinmap_import_candidates")
      .select("place_name")
      .eq("id", inserted!.id)
      .single();
    expect(stillThere?.place_name).toBe("Test Place");
  });

  it("enforces unique(user_id, external_key)", async () => {
    const key = `rls-dupe-${Date.now()}`;
    const row = {
      user_id: userA.id,
      external_key: key,
      place_name: "Dupe Test",
      visit_time: new Date().toISOString(),
    };
    const first = await userA.client
      .from("pinmap_import_candidates")
      .insert(row);
    expect(first.error).toBeNull();

    const second = await userA.client
      .from("pinmap_import_candidates")
      .insert(row);
    expect(second.error).not.toBeNull();
  });

  it("keeps import-staging objects non-public, unlike pin-photos", async () => {
    const path = `${userA.id}/rls-test-${Date.now()}.txt`;
    const { error: uploadErr } = await userA.client.storage
      .from("import-staging")
      .upload(path, new Blob(["test"]), { contentType: "text/plain" });
    expect(uploadErr).toBeNull();

    const { data: publicUrlData } = userA.client.storage
      .from("import-staging")
      .getPublicUrl(path);
    const res = await fetch(publicUrlData.publicUrl);
    expect(res.status).not.toBe(200);

    await admin.storage.from("import-staging").remove([path]);
  });

  it("approve_import_candidate rejects a candidate with no coordinates", async () => {
    const { data: candidate } = await userA.client
      .from("pinmap_import_candidates")
      .insert({
        user_id: userA.id,
        external_key: `rls-nocoord-${Date.now()}`,
        place_name: "No Coordinates",
        visit_time: new Date().toISOString(),
      })
      .select()
      .single();

    const { error } = await userA.client.rpc("approve_import_candidate", {
      p_candidate_id: candidate!.id,
    });
    expect(error).not.toBeNull();
  });

  it("approve_import_candidate is idempotent — calling it twice makes one pin", async () => {
    const placeName = `RLS Approve Test ${Date.now()}`;
    const { data: candidate } = await userA.client
      .from("pinmap_import_candidates")
      .insert({
        user_id: userA.id,
        external_key: `rls-approve-${Date.now()}`,
        place_name: placeName,
        visit_time: new Date().toISOString(),
        suggested_lat: 1.35,
        suggested_lng: 103.82,
        geocode_confidence: "high",
      })
      .select()
      .single();

    const first = await userA.client.rpc("approve_import_candidate", {
      p_candidate_id: candidate!.id,
    });
    expect(first.error).toBeNull();

    const second = await userA.client.rpc("approve_import_candidate", {
      p_candidate_id: candidate!.id,
    });
    // Second call is the dropped-response retry case — succeeds and
    // returns the same pin id, not an error and not a duplicate pin.
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const { data: pins } = await admin
      .from("pinmap_pinned_places")
      .select("id")
      .eq("user_id", userA.id)
      .eq("query", placeName);
    expect(pins).toHaveLength(1);

    await admin.from("pinmap_pinned_places").delete().eq("id", first.data);
  });
});
