# Handoff — GPU shard run unblocked (2026-08-28)

Branch: `claude/photo-tagging-duplication-c8a66b` · Worktree: `pin-map-gpu-shard-test` on `aorus`

> Infrastructure specifics (public hostname, exact image versions, on-disk paths
> to credential files, dataset sizes) are deliberately kept out of this file —
> this repo is public. See the internal infra notes for those.

## TL;DR

The backfill was failing on its very first Supabase query with PostgREST
`PGRST205 "Could not find the table 'public.pinmap_place_photos' in the schema
cache"`. **Cause: `.env` pointed at the wrong Supabase stack.** aorus4 runs two
complete stacks side by side, and `:8000` is not ours. Nothing was broken, no
data was lost, no grants were revoked. Fixed by repointing `.env` to `:8010`
with that stack's keys.

## Root cause

aorus4 (`192.168.1.246`) hosts two independent Supabase deployments:

| | Old stack | **pin-map stack** |
|---|---|---|
| Containers | `supabase-*` | `pinmap-supabase-*` |
| Postgres | 15.x | **17.x** |
| Gateway | Kong → host `:8000` | **Envoy → host `:8010`** |
| Public URL | — | (internal — see infra notes) |
| Compose dir | (on the Supabase host) | (on the Supabase host) |
| `pinmap*` tables | **none** | the full dataset |

The stacks have **different JWT secrets**; keys are not interchangeable.

`PGRST205` was literally accurate — on `:8000` that table does not exist. The
error text ("schema cache") misleadingly suggests a stale cache or a revoked
grant, so it invites the wrong diagnosis.

## What changed

**Committed** — `224b2c7` "Point Supabase references at the pinmap stack on :8010"

- `.gitignore` — added `.env.bak.*` (timestamped backups carry a live service-role key)
- `ansible/deploy.yml` — `:8000` → `:8010` in the example-vars comment
- `macstudio-backfill-spec.md` — two endpoint references corrected

Tests run before commit: **1026 passed, 9 skipped, exit 0**.

**Not committed** (gitignored / outside the repo):

- `.env` in this worktree — `VITE_SUPABASE_URL` → `http://192.168.1.246:8010`,
  plus the anon and service-role keys copied from the pinmap stack's own env.
  A timestamped `.env.bak.*` backup was written (mode 600).
- `~/.ssh/config` on aorus — the `aorus4` alias pointed at a dead address and was
  corrected to `192.168.1.246`. Host key verified against the box and added.
  Backups in `~/.claude/.backups/ssh/`.

## Other machines need the same fix

`.env` is gitignored, so the fix does **not** propagate. Any checkout still on
`:8000` will fail identically:

- the original `pin-map` checkout on aorus
- any copy on macstudio (per `macstudio-backfill-spec.md`)
- `fb-import-relay` / `notify-relay` deploy vars, if they carry a Supabase URL

Correct value: `VITE_SUPABASE_URL=http://192.168.1.246:8010`, with the anon and
service-role keys taken from the pinmap stack's own `.env` on the Supabase host.
Use the LAN `:8010` rather than the public domain for backfills — same host, no
CDN in the path.

## Misleading signals (so nobody re-runs this diagnosis)

Everything below is what `:8000` legitimately returns, and each one pointed the
wrong way:

- **Keys appeared valid.** A wrong key 401s at the gateway. Ours reached
  PostgREST and got a 404, which looked like proof the credentials were fine —
  they were fine *for the wrong stack*, whose secret they still match.
- **`/auth/v1/health` returned 200.** The GoTrue version it reported belongs to
  the old stack; the pinmap stack runs a newer one. The version was the tell.
- **`storage.buckets` returned `[]`.** Read as a wiped volume. It was an
  unrelated empty stack.
- **`storage.*` resolved while `public.*` did not.** Looked like strong evidence
  of `revoke usage on schema public`. Equally consistent with a database that
  never had those tables.

**Fastest check next time:** list the containers and published ports on the
Supabase host and confirm which stack owns the port you are querying, before
theorising about grants, caches, or data loss.

## Outstanding

1. **The GPU sharded path is still unexercised.** The tagging queue is drained —
   **0 pending** — so `backfill-photo-tags.ts` correctly exits as a no-op. There
   is no work to shard.
2. **5 permanently-failed rows** (Aug 26, `tag_attempts: 3`): four
   `vision model response failed validation`, one `The operation was aborted`.
   Requeuing them is the way to give the GPU path real work. Production write,
   not yet run:

   ```sql
   update public.pinmap_place_photos
      set tag_status = 'pending', tag_attempts = 0, tag_last_error = null
    where tag_status = 'failed';
   ```
3. **Config drift on aorus4** — a stale authorized key and a dead SSH alias were
   both stale alongside `.env`. Worth a sweep for other references to the
   retired stack.

## Verification

```bash
cd /home/joggerjoel/Developer/pin-map-gpu-shard-test
bun -e 'const r = await fetch(process.env.VITE_SUPABASE_URL + "/rest/v1/pinmap_place_photos?limit=1", {headers:{apikey:process.env.SERVICE_ROLE_KEY,Authorization:"Bearer "+process.env.SERVICE_ROLE_KEY}}); console.log(r.status)'
# expect: 200
```
