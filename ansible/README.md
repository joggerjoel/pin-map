# pin-map ansible

Deploys pin-map to production via Ansible instead of ad-hoc shell commands.
Lives inside the pin-map repo (not the general-purpose fleet ansible) so it
can never be swept into an unrelated fleet-wide run.

**Isolation is the point.** Two deploy targets exist, each with its own
playbook that hard-codes its own group — `deploy.yml` only ever targets
`pinmap_prod`, `deploy-review.yml` only ever targets `pinmap_review`.
Local development is `bun run dev` on your own machine — there is no "dev"
host in this inventory at all, so there's nothing for a playbook run to hit
by mistake.

## Targets

|                | production           | review                  |
| -------------- | -------------------- | ----------------------- |
| playbook       | `deploy.yml`         | `deploy-review.yml`     |
| group          | `pinmap_prod`        | `pinmap_review`         |
| container      | `pin-map-web`        | `pin-map-review`        |
| image          | `pin-map-web:latest` | `pin-map-review:latest` |
| host port      | `127.0.0.1:8090`     | `127.0.0.1:8099`        |
| source dir     | `~/…/pin-map`        | `~/…/pin-map-review`    |
| restart policy | `unless-stopped`     | none (disposable)       |

Both groups may point at the same machine — that's the normal case, one box
running two containers. Isolation is therefore by container name, port, and
directory, not by host. `deploy-review.yml` opens with an `assert` that
fails the run if any of its names has been edited into collision with
production's, so a careless var edit can't turn a review deploy into a
production one.

The review container serves a **byte-identical bundle** to production: the
Dockerfile runs `bun run build`, and vite's production mode loads
`.env.production` for either target. Review shows you exactly what prod will
serve, not a differently-configured approximation.

## Setup

```bash
cd ansible
cp inventory.example.yml inventory.local.yml   # then fill in your real host
```

`inventory.local.yml` is gitignored — real IPs, jump hosts, and usernames
never belong in the tracked (public) repo.

## Usage

```bash
cd ansible

# Review — look at a build before it goes live
ansible pinmap_review -m ping        # reachability check
ansible-playbook deploy-review.yml   # deploy to the review slot

# Production — replaces the live site
ansible pinmap_prod -m ping          # reachability check
ansible-playbook deploy.yml          # deploy
```

The review container binds to loopback only, matching production's posture
— nothing is exposed to the LAN. Reach it over an SSH tunnel:

```bash
ssh -L 8099:127.0.0.1:8099 aorus4    # then open http://localhost:8099
```

Override `bind_address` only if you deliberately want it open on the
network: `ansible-playbook deploy-review.yml -e bind_address=0.0.0.0`.

**Port conflicts.** `8099` is only a default — the host runs plenty of
other services (8091 was already taken, which is why it isn't the default
any more). Override per-run:

```bash
ansible-playbook deploy-review.yml -e container_port=8123
```

The playbook preflights the port before it rsyncs or builds anything, and
names whatever is holding it rather than letting `docker run` die with a
bare "address already in use". It checks two ways, because they catch
different things: `docker ps --filter publish=` finds container
publications, and `ss -ltn` finds plain daemons that no container knows
about. Your own `pin-map-review` container is excluded — on a redeploy it
legitimately holds the port until the `docker rm -f` step frees it.

To see what's free on the host before choosing:

```bash
ssh aorus4 'ss -ltnH | awk "{print \$4}" | grep -oE "[0-9]+$" | sort -un'
```

**Getting there.** Both targets need SSH+rsync to the host, so you must be
on the same LAN as it, or reach it through a jump host. `~/.ssh/config` has
no plain `Host aorus4` entry — only `aorus4-jump`, which proxies via
`172.13.125.161`. From an arbitrary network neither the LAN IP nor that
jump host is reachable, and the deploy will stop at the rsync step with
`ssh: connect to host … port 22: Operation timed out`. That's a network
problem, not a playbook problem; `ansible <group> -m ping` tells you which
you have.

**`--check` caveat**: in both playbooks every task is a raw `command`
(rsync / docker build / docker run) rather than an idempotent Ansible
module, since the goal was to wrap the exact steps already proven to work,
not rewrite the deploy mechanics. Ansible can't safely predict what an
arbitrary shell command would do, so in check mode these tasks report as
skipped rather than actually dry-running the deploy. `--check --diff`
therefore tells you very little; use `ansible <group> -m ping` to verify
connectivity before a real run instead.

What you _can_ verify offline, without reaching the host:

```bash
ansible-playbook deploy-review.yml --syntax-check
ansible-inventory --list                       # both groups resolve?
# the collision guard actually fires:
ansible-playbook deploy-review.yml -c local -e container_name=pin-map-web
```

That last one must fail at the assert with `changed=0`. If it ever
succeeds, the guard has been broken and review can reach production.
