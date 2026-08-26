# Pin Map — Login/Auth Handoff

Ground truth on how sign-in actually works, client and database side, plus
how to complete a sign-in programmatically (no human needed to read an
email) for testing. Written because testing the new Browse/Groups UI
(`image-group-plan.md`) needs a real signed-in session, and completing
email OTP by hand isn't something an agent can do unassisted.

## Flow type: email OTP, not magic link

Confirmed by both the UI and the actual Supabase call: the login form asks
for a 6-digit code (`autoComplete="one-time-code"`, placeholder `123456`),
and the verify step passes a `token` + `type: "email"` pair to
`verifyOtp()`, not a `token_hash` / `type: "magiclink"` URL-redirect flow.
No `window.location` parsing, no
PKCE handling anywhere in the client. Per `idea.md`: "Auth is email OTP (no
passwords)."

## Client-side: `src/hooks/useAuth.ts`

Auth state is a plain `useState<AuthStatus>`, not a real state machine.

```ts
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
```

Source of truth is a `Session | null` from supabase-js, kept via
`supabase.auth.getSession()` (initial read) + `supabase.auth.onAuthStateChange()`
(ongoing updates) — no custom persistence logic in this file.
`email`/`userId`/`accessToken` are derived straight off the session:
`session?.user.email`, `session?.user.id`, `session?.access_token`.

The two calls that matter:

```ts
// sendOtp
await supabase.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: true },
});

// verifyOtp
await supabase.auth.verifyOtp({ email, token: code, type: "email" });
```

`shouldCreateUser: true` means sign-up and sign-in are the same call —
there's no separate registration step, and no `handle_new_user` trigger or
`public.users`/`public.profiles` mirror table anywhere in `supabase/*.sql`.
GoTrue owns account provisioning entirely; the app never mirrors
`auth.users` into its own schema.

On a successful `verifyOtp`, two fire-and-forget side effects run (never
block or surface to the user): `incrementLogin()` (an RPC, see below) and
`notifyLogin(accessToken, ip, isNewAccount)` (POST to `notify-relay`,
outside this repo's direct concern). `isNewAccount` is inferred by
checking whether `session.user.created_at` is within 60 seconds of now,
since there's no separate "just registered" event to key off of.

## UI: `src/components/LoginForm.tsx`

Two-step local-state form: `step: "email" | "code"`. Takes `onSendOtp`/
`onVerifyOtp` as **props** (dependency-injected), not calling `useAuth()`
directly — `App.tsx` wires `useAuth().sendOtp`/`verifyOtp` in. Validation
is trivial (trim + no-op on empty; no email-format regex, no code-length
check). Parses GoTrue's literal rate-limit error string ("...after N
seconds.") via a regex to drive a "Resend in Ns" countdown button.

## Database side

**No `handle_new_user` trigger, no custom `public.users` table.** Every
user-scoped table's RLS policy trusts `auth.uid()` directly — that's the
entire identity-propagation mechanism, e.g. (`schema.sql`):

```sql
create policy "pinmap_pinned_places_select_own"
  on public.pinmap_pinned_places for select
  using (auth.uid() = user_id);
```

The same `auth.uid() = user_id` pattern repeats across every `pinmap_*`
table (`pinmap_custom_tags`, `pinmap_place_photos`, `pinmap_photo_groups`,
`pinmap_user_settings`, etc.) — `auth.uid()` resolves from the JWT `sub`
claim GoTrue embeds in the access token.

**The "owner" (`schema_owner.sql`)** — a data-driven table, not a
SQL-enforced singleton:

```sql
create table if not exists public.pinmap_owner (
  user_id uuid primary key references auth.users(id)
);
create policy "pinmap_owner_select_all"
  on public.pinmap_owner for select using (true);
grant select on public.pinmap_owner to anon, authenticated;
```

Readable by anyone, including `anon`. Nothing in the schema stops a second
row from being inserted — "exactly one owner" is a convention, not a
constraint. The owner's `pinmap_pinned_places` rows are the ones exposed
to `anon` (the public map view); every other signed-in user only ever
sees their own rows.

**Usage-gating RPC** (`schema_token_usage.sql`), called by `useAuth.ts`'s
`incrementLogin()`:

```sql
create or replace function public.pinmap_increment_usage(
  p_places_delta integer, p_login_delta integer
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.pinmap_token_usage (user_id, places_pinned_count, login_count)
  values (auth.uid(), greatest(p_places_delta, 0), greatest(p_login_delta, 0))
  on conflict (user_id) do update set ...;
end; $$;
```

`security definer`, scoped to `auth.uid()` itself (never a client-supplied
id) to stay race-safe across concurrent tabs. Drives whether the app keeps
using the bundled Mapbox token (`PLACES_PINNED_LIMIT = 50`,
`LOGIN_LIMIT = 10` in `src/lib/tokenUsage.ts`); the owner is exempted in
app code, not SQL.

## How to actually complete a sign-in (no email needed)

This is the load-bearing part of this handoff. `src/test/importCandidatesRls.live.test.ts`
already does this against the real instance — same pattern, reusable for
manual verification:

```ts
import { createClient } from "@supabase/supabase-js";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signInAs(email: string) {
  await admin.auth.admin.createUser({ email, email_confirm: true });

  // Mint a real OTP server-side instead of waiting on an email.
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  // On this self-hosted GoTrue version, `hashed_token`/`type: "magiclink"`
  // both 403 as "otp_expired" -- the plain 6-digit `email_otp` code (the
  // same one that'd be emailed to a real user) is what actually verifies.
  // Confirmed by hand against the live instance.
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified } = await client.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  return verified.session; // .access_token, .user.id, etc.
}
```

Requires `SERVICE_ROLE_KEY` (in `.env`, never the anon key) — this bypasses
RLS entirely, so treat it the same way the live test does: throwaway
`@example.invalid` addresses, real users deleted after the run
(`admin.auth.admin.deleteUser`), never run against data that matters.

For an actual **browser** session (not a Node script) — the piece the
above doesn't give you — the resulting `session` needs to land in
supabase-js's own storage so a page load picks it up. `supabaseClient.ts`
sets no explicit `auth` options, so it's on defaults —
`persistSession: true`, storage is `window.localStorage`, key
`sb-<project-ref>-auth-token`. Setting that key directly with the session
object obtained
above (matching the shape supabase-js itself writes) should let a fresh
page load pick it up via `getSession()` — not verified end-to-end in this
handoff, flagged as the next thing to try rather than asserted as working.

For a **human**, there is no bypass: request the code from the login form,
receive the real email, type it in. No documented dev-mode shortcut exists
anywhere in `README.md` or code comments.

## Config

Client env vars (read in `supabaseClient.ts`): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`. **Both are missing from `.env.example`** — a
fresh clone following the example file alone wouldn't know it needs them.

`GMAIL_APP_PASSWORD` and `SMTP_ADMIN_EMAIL` in `.env` are **dead** —
grepped across every `.md`/`.ts`/`.yml`/`.sh` in the repo, neither name is
read anywhere. `notify-relay/index.ts` (the actual SMTP consumer) reads a
different set of names (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`NOTIFY_EMAIL_TO`, `RELAY_SECRET`) from its own separate deployment's env,
not this repo's root `.env`. These two look like leftovers from an earlier
direct-Gmail-SMTP implementation, never cleaned up.

`notify-relay/index.ts` has a comment referencing a Postgres trigger in
`schema_notify_new_account.sql` (via `pg_net`, hitting a `/notify-access`
endpoint) — **that file does not exist** anywhere in `supabase/`. Either
never committed, removed, or lives only on the live instance outside
version control. Doesn't affect login itself (the client-driven
`/notify-login` path `useAuth.ts` actually calls doesn't depend on it),
but it's a real inconsistency between a code comment and repo state worth
someone's attention separately from this handoff.

**GoTrue's own SMTP configuration (what actually sends the OTP email,
`MAILER_OTP_EXP`, email-confirmation requirements) is not tracked in this
repo at all.** `ansible/` only deploys the `pin-map-web` app container (and
`fb-import-relay`/`tusd`) to `aorus4` — the self-hosted Supabase/GoTrue
stack itself is provisioned separately, outside `pin-map`. Don't guess at
those values; there's no ground truth for them here.

## Non-live tests mock auth entirely

`useAuth.test.ts`/`LoginForm.test.tsx` mock `supabase.auth.*` completely —
no real network calls. `vite.config.ts` fakes the env vars only so
`import.meta.env` reads resolve at module load:

```ts
env: {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-anon-key",
},
```

The only place real auth happens in the test suite is the live test file
above, gated behind `RUN_LIVE_SUPABASE_TESTS=1`.
