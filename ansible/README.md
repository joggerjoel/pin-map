# pin-map ansible

Deploys pin-map to production via Ansible instead of ad-hoc shell commands.
Lives inside the pin-map repo (not the general-purpose fleet ansible) so it
can never be swept into an unrelated fleet-wide run.

**Isolation is the point**: `pinmap_prod` is the only group this directory
ever defines, and `deploy.yml` only ever targets it. Local development is
`bun run dev` on your own machine — there is no "dev" host in this
inventory at all, so there's nothing for a playbook run to hit by mistake.

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
ansible pinmap_prod -m ping          # reachability check
ansible-playbook deploy.yml          # deploy
ansible-playbook deploy.yml --check --diff   # dry run (see caveat below)
```

**`--check` caveat**: every task here is a raw `command` (rsync / docker
build / docker run) rather than an idempotent Ansible module, since the
goal was to wrap the exact steps already proven to work, not rewrite the
deploy mechanics. Ansible can't safely predict what an arbitrary shell
command would do, so in check mode these tasks report as skipped rather
than actually dry-running the deploy. Use `ansible pinmap_prod -m ping`
to verify connectivity before a real run instead.
